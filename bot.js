require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytpl = require('ytpl');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const prefix = '!';
let queue = [];
let currentIndex = 0;
let player;
let connection;
let voiceChannelId;

client.once('ready', () => {
  console.log('Bot is ready!');
});

client.on('messageCreate', async message => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'play') {
    await loadPlaylist(message, args[0]);
  } else if (command === 'skip') {
    skipSong(message);
  } else if (command === 'previous') {
    previousSong(message);
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  // Check if the bot is in a voice channel
  if (!voiceChannelId) return;

  const channel = client.channels.cache.get(voiceChannelId);
  if (!channel) return;

  // Count members in the voice channel (excluding bots)
  const memberCount = channel.members.filter(member => !member.user.bot).size;

  if (memberCount > 0 && player.state.status === AudioPlayerStatus.Paused) {
    // Resume playback if there are members and the player is paused
    player.unpause();
    console.log('Resumed playback');
  } else if (memberCount === 0 && player.state.status === AudioPlayerStatus.Playing) {
    // Pause playback if there are no members and the player is playing
    player.pause();
    console.log('Paused playback');
  }
});

async function loadPlaylist(message, playlistUrl) {
  try {
    const playlist = await ytpl(playlistUrl);
    queue = playlist.items.map(item => ({
      title: item.title,
      url: item.url,
    }));

    message.channel.send(`Loaded ${queue.length} songs from the playlist.`);
    
    if (!connection) {
      connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      voiceChannelId = message.member.voice.channel.id;
    }

    if (!player) {
      player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      });
      connection.subscribe(player);
      player.on(AudioPlayerStatus.Idle, () => {
        currentIndex = (currentIndex + 1) % queue.length;
        playSong();
      });
    }

    playSong();
  } catch (error) {
    console.error(error);
    message.channel.send('An error occurred while loading the playlist.');
  }
}

function playSong() {
  const song = queue[currentIndex];
  const resource = createAudioResource(ytdl(song.url, { filter: 'audioonly' }));
  player.play(resource);
  console.log(`Now playing: ${song.title}`);

  // Check if the channel is empty and pause if so
  const channel = client.channels.cache.get(voiceChannelId);
  if (channel) {
    const memberCount = channel.members.filter(member => !member.user.bot).size;
    if (memberCount === 0) {
      player.pause();
      console.log('Paused playback due to empty channel');
    }
  }
}

function skipSong(message) {
  if (queue.length === 0) {
    return message.channel.send('The queue is empty.');
  }
  currentIndex = (currentIndex + 1) % queue.length;
  playSong();
  message.channel.send(`Skipped to the next song: ${queue[currentIndex].title}`);
}

function previousSong(message) {
  if (queue.length === 0) {
    return message.channel.send('The queue is empty.');
  }
  currentIndex = (currentIndex - 1 + queue.length) % queue.length;
  playSong();
  message.channel.send(`Went back to the previous song: ${queue[currentIndex].title}`);
}

client.login(process.env.DISCORD_BOT_TOKEN);