require('dotenv').config();

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const { 
  createAudioPlayer, createAudioResource, AudioPlayerStatus, 
  VoiceConnectionStatus, joinVoiceChannel, entersState 
} = require('@discordjs/voice');
const { Client, GatewayIntentBits } = require('discord.js');
const play = require('play-dl');

class MusicBot {
  constructor(client, name, voiceChannelId) {
    this.client = client;
    this.name = name;
    this.voiceChannelId = voiceChannelId;
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
      const channel = await this.client.channels.fetch(this.voiceChannelId);
      if (!channel || channel.type !== 2) { // 2 is the value for GUILD_VOICE
        throw new Error('Invalid voice channel');
      }

      this.connection = joinVoiceChannel({
        channelId: this.voiceChannelId,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
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

      setInterval(() => this.checkVoiceChannel(), 5000);

      console.log(`${this.name}: Successfully joined voice channel`);
      return this.connection;
    } catch (error) {
      console.error(`${this.name}: Error joining voice channel:`, error);
      return null;
    }
  }

  async checkVoiceChannel() {
    const channel = await this.client.channels.fetch(this.voiceChannelId);
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

  async addToQueue(message, songUrl) {
    try {
      const songInfo = await play.video_info(songUrl);
      this.queue.push({
        title: songInfo.video_details.title,
        url: songUrl,
      });
      message.reply(`Added to queue: ${songInfo.video_details.title}`);
      if (this.queue.length === 1) {
        this.playSong();
      }
    } catch (error) {
      console.error('Error adding song to queue:', error);
      message.reply('Error adding song to queue. Please try again.');
    }
  }

  async loadPlaylist(message, playlistUrl) {
    try {
      const playlist = await play.playlist_info(playlistUrl);
      const videos = await playlist.all_videos();

      videos.forEach(video => {
        this.queue.push({
          title: video.title,
          url: video.url,
        });
      });

      message.reply(`Added ${videos.length} songs from playlist to queue.`);
      if (this.queue.length === videos.length) {
        this.playSong();
      }
    } catch (error) {
      console.error('Error loading playlist:', error);
      message.reply('Error loading playlist. Please try again.');
    }
  }

  async skipSong(message) {
    if (this.queue.length > 0) {
      this.player.stop();
      message.reply('Skipped to the next song.');
    } else {
      message.reply('No songs in the queue to skip.');
    }
  }

  showQueue(message) {
    if (this.queue.length === 0) {
      message.reply('The queue is empty.');
    } else {
      const queueList = this.queue.map((song, index) =>
        `${index + 1}. ${song.title}`
      ).join('\n');
      message.reply(`Current queue:\n${queueList}`);
    }
  }

  async playSong() {
  if (this.queue.length > 0 && this.currentIndex < this.queue.length) {
    const song = this.queue[this.currentIndex];
    try {
      const outputFile = path.join(__dirname, `${Date.now()}.%(ext)s`);
      
      const command = `yt-dlp --no-playlist --extract-audio --audio-format mp3 --audio-quality 0 --output "${outputFile}" ${song.url}`;
      
      exec(command, async (error, stdout, stderr) => {
        if (error) {
          console.error(`Error downloading audio: ${error.message}`);
          return;
        }
        
        const files = fs.readdirSync(__dirname);
        const audioFile = files.find(file => file.startsWith(path.basename(outputFile, path.extname(outputFile))));
        
        if (!audioFile) {
          console.error('Audio file not found after download');
          return;
        }
        
        const resource = createAudioResource(path.join(__dirname, audioFile));
        this.player.play(resource);
        
        console.log(`Now playing: ${song.title}`);
        
        // Clean up the file after playing
        this.player.once(AudioPlayerStatus.Idle, () => {
          fs.unlinkSync(path.join(__dirname, audioFile));
        });
      });
    } catch (error) {
      console.error('Error playing song:', error);
      this.currentIndex++;
      this.playSong();
    }
  }
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
  if (message.channel.type !== 0) return; // 0 is the value for GUILD_TEXT
  
  const bot = Array.from(bots.values()).find(bot =>
    message.member && message.member.voice.channelId === bot.voiceChannelId
  );

  if (bot && message.content.startsWith(bot.prefix)) {
    await bot.handleCommand(message);
  }
});

function initializeBots() {
  const botConfigs = [
    { name: 'Trap Music Bot', voiceChannelId: '1291366977667076170' },
    // Add more bot configurations as needed
  ];

  botConfigs.forEach(config => {
    const bot = new MusicBot(client, config.name, config.voiceChannelId);
    bot.initialize();
    bots.set(config.voiceChannelId, bot);
  });
}

client.login(process.env.DISCORD_BOT_TOKEN);
