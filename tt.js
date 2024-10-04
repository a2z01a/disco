require('dotenv').config();
const { 
  createAudioPlayer, createAudioResource, AudioPlayerStatus, 
  VoiceConnectionStatus, joinVoiceChannel, entersState 
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js'); // Added ChannelType for channel type checking
const play = require('play-dl');

class MusicBot {
  constructor(client, name, channelId) {
    this.client = client;
    this.name = name;
    this.channelId = channelId;
    this.prefix = '!';
    this.queue = [];
    this.currentIndex = 0;
    this.player = null;
    this.connection = null;
    this.isPaused = false;
  }

  async initialize() {
    await this.joinVoiceChannel();
  }

  async joinVoiceChannel() {
    try {
      const channel = await this.client.channels.fetch(this.channelId);
      
      // Log the channel details for debugging
      console.log("Fetched channel:", channel);
      
      // Make sure we are working with a valid voice channel
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        throw new Error('Invalid voice channel');
      }

      this.connection = joinVoiceChannel({
        channelId: this.channelId,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
      });

      // Wait until the voice connection is ready
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

      // Check if the voice channel is empty every 5 seconds
      setInterval(() => this.checkVoiceChannel(), 5000);

      console.log(`${this.name}: Successfully joined voice channel`);
      return this.connection;
    } catch (error) {
      console.error(`${this.name}: Error joining voice channel:`, error);
      return null;
    }
  }

  async checkVoiceChannel() {
    const channel = await this.client.channels.fetch(this.channelId);
    if (channel && channel.members.size === 1) {
      if (!this.isPaused) {
        this.player.pause();
        this.isPaused = true;
        console.log(`${this.name}: Paused playback due to empty voice channel`);
      }
    } else if (this.isPaused) {
      this.player.unpause();
      this.isPaused = false;
      console.log(`${this.name}: Resumed playback`);
    }
  }

  async handleCommand(message) {
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
        this.queue.splice(existingIndex, 1); // Remove duplicate
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
  initializeBots();
});

client.on('messageCreate', async (message) => {
  if (message.channel.type !== ChannelType.GuildText) return;

  const associatedVoiceChannel = message.channel.guild.channels.cache
    .find(channel => channel.type === ChannelType.GuildVoice && channel.name === message.channel.name);
  
  if (associatedVoiceChannel) {
    const bot = bots.get(associatedVoiceChannel.id);
    if (bot && message.content.startsWith(bot.prefix)) {
      await bot.handleCommand(message);
    }
  }
});

function initializeBots() {
  const botConfigs = [
    { name: 'PlayBot', channelId: '1291366977667076170' }, // Make sure this is correct
  ];

  botConfigs.forEach(config => {
    const bot = new MusicBot(client, config.name, config.channelId);
    bot.initialize();
    bots.set(config.channelId, bot);
  });
}

client.login(process.env.DISCORD_BOT_TOKEN);
