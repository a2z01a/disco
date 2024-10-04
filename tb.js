require('dotenv').config();
const { 
  createAudioPlayer, createAudioResource, AudioPlayerStatus, 
  VoiceConnectionStatus, joinVoiceChannel, entersState 
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const { Client, GatewayIntentBits } = require('discord.js');
const play = require('play-dl');

class MusicBot {
  constructor(client, roomName) {
    this.client = client;
    this.roomName = roomName;
    this.prefix = '!';
    this.queue = [];
    this.currentIndex = 0;
    this.player = null;
    this.connection = null;
    this.voiceChannelId = null;
    this.textChannelId = null;
    this.isPaused = false;
  }

  async initialize(guildId, voiceChannelId, textChannelId) {
    this.voiceChannelId = voiceChannelId;
    this.textChannelId = textChannelId;
    await this.joinVoiceChannel(guildId);
  }

  async joinVoiceChannel(guildId) {
    try {
      this.connection = joinVoiceChannel({
        channelId: this.voiceChannelId,
        guildId: guildId,
        adapterCreator: this.client.guilds.cache.get(guildId).voiceAdapterCreator,
      });

      await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
      
      if (!this.player) {
        this.player = createAudioPlayer();
        this.connection.subscribe(this.player);

        this.player.on('error', (error) => {
          console.error('Playback error:', error.message);
          this.playSong().catch(console.error);
        });

        this.player.on(AudioPlayerStatus.Idle, () => {
          this.currentIndex++;
          if (this.currentIndex < this.queue.length) {
            this.playSong().catch(console.error);
          }
        });
      }

      // Check if voice channel is empty every 5 seconds
      setInterval(() => this.checkVoiceChannel(), 5000);

      return this.connection;
    } catch (error) {
      console.error('Error joining voice channel:', error);
      return null;
    }
  }

  async checkVoiceChannel() {
    const channel = this.client.channels.cache.get(this.voiceChannelId);
    if (channel && channel.members.size === 1) {
      if (!this.isPaused) {
        this.player.pause();
        this.isPaused = true;
        console.log('Paused playback due to empty voice channel');
      }
    } else if (this.isPaused) {
      this.player.unpause();
      this.isPaused = false;
      console.log('Resumed playback');
    }
  }

  async handleCommand(message) {
    if (message.channel.id !== this.textChannelId) return;

    const args = message.content.slice(this.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'play') {
      const songUrl = args[0];
      if (!songUrl) {
        return message.reply('Please provide a song URL or search term.');
      }
      await this.addToQueue(message, songUrl);
    } else if (command === 'playlist') {
      const playlistUrl = args[0];
      if (!playlistUrl) {
        return message.reply('Please provide a playlist URL.');
      }
      await this.loadPlaylist(message, playlistUrl);
    } else if (command === 'skip') {
      await this.skipSong(message);
    } else if (command === 'queue') {
      this.showQueue(message);
    }
  }

  async addToQueue(message, query) {
    try {
      let songInfo;
      if (query.startsWith('http')) {
        songInfo = await play.video_info(query);
      } else {
        const searchResult = await play.search(query, { limit: 1 });
        if (searchResult.length === 0) {
          return message.reply('No results found for the given search term.');
        }
        songInfo = searchResult[0];
      }

      const song = {
        title: songInfo.title,
        url: songInfo.url,
      };

      const existingIndex = this.queue.findIndex(s => s.url === song.url);
      if (existingIndex !== -1) {
        this.queue.splice(existingIndex, 1);
      }
      this.queue.push(song);

      message.channel.send(`Added to queue: ${song.title}`);

      if (this.queue.length === 1) {
        this.playSong();
      }
    } catch (error) {
      console.error('Error adding song to queue:', error);
      message.channel.send('An error occurred while adding the song to the queue.');
    }
  }

  async loadPlaylist(message, playlistUrl) {
    try {
      const playlist = await play.playlist_info(playlistUrl);
      const videos = await playlist.all_videos();

      this.queue = videos.map(video => ({
        title: video.title,
        url: video.url,
      }));

      message.channel.send(`Loaded ${this.queue.length} songs from the playlist.`);
      console.log(`Loaded ${this.queue.length} songs from the playlist.`);

      if (!this.player.playbackResource) {
        this.playSong();
      }
    } catch (error) {
      console.error('Error in loadPlaylist function:', error);
      message.channel.send('An error occurred while loading the playlist. Please try again.');
    }
  }

  async playSong() {
    if (this.queue.length === 0) {
      console.log('Queue is empty');
      return;
    }

    try {
      const song = this.queue[this.currentIndex];
      console.log(`Attempting to play: ${song.title}`);

      const ytDlp = spawn('yt-dlp', [
        '-o', '-',
        '-f', 'bestaudio',
        song.url
      ]);

      const resource = createAudioResource(ytDlp.stdout);
      this.player.play(resource);

    } catch (error) {
      console.error('Error in playSong function:', error);
      this.currentIndex = (this.currentIndex + 1) % this.queue.length;
      return this.playSong();
    }
  }

  async skipSong(message) {
    if (this.queue.length === 0) {
      return message.channel.send('The queue is empty.');
    }
    this.currentIndex = (this.currentIndex + 1) % this.queue.length;
    try {
      await this.playSong();
      message.channel.send(`Skipped to the next song: ${this.queue[this.currentIndex].title}`);
    } catch (error) {
      console.error('Error in skipSong:', error);
      message.channel.send('An error occurred while skipping the song.');
    }
  }

  showQueue(message) {
    if (this.queue.length === 0) {
      return message.channel.send('The queue is empty.');
    }

    const queueList = this.queue.map((song, index) => 
      `${index + 1}. ${song.title}`
    ).join('\n');

    message.channel.send(`Current queue:\n${queueList}`);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const bots = new Map();

client.once('ready', () => {
  console.log('Bot is ready!');
  // Initialize bots for specific rooms here
  // Example: bots.set('Trap Music', new MusicBot(client, 'Trap Music'));
});

client.on('messageCreate', async (message) => {
  const bot = Array.from(bots.values()).find(bot => bot.textChannelId === message.channel.id);
  if (bot && message.content.startsWith(bot.prefix)) {
    await bot.handleCommand(message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);

// Initialize bots for specific rooms
// Replace these with your actual room IDs
const roomConfigs = [
  { name: '「🗣」Voice', guildId: '1284917135595798709', voiceChannelId: '1291366977667076170', textChannelId: '1291366977667076170' },
  // Add more room configurations as needed
];

roomConfigs.forEach(config => {
  const bot = new MusicBot(client, config.name);
  bot.initialize(config.guildId, config.voiceChannelId, config.textChannelId);
  bots.set(config.name, bot);
});