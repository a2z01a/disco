require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus, joinVoiceChannel, entersState, getVoiceConnection } = require('@discordjs/voice');

const ytdl = require('ytdl-core');
const ytpl = require('ytpl');
const play = require('play-dl');

let player;
let connection;

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

async function joinVoiceChannel(message) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    message.reply("You need to be in a voice channel first!");
    return null;
  }

  try {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    
    if (!player) {
      player = createAudioPlayer();
      connection.subscribe(player);
    }

    return connection;
  } catch (error) {
    console.error('Error joining voice channel:', error);
    message.reply('Failed to join the voice channel. Please try again.');
    return null;
  }
}

client.on('voiceStateUpdate', (oldState, newState) => {
  // Check if the bot is in a voice channel
  if (!voiceChannelId) return;

  const channel = client.channels.cache.get(voiceChannelId);
  if (!channel) return;

  // Count members in the voice channel (excluding bots)
  const memberCount = channel.members.filter(member => !member.user.bot).size;

  if (memberCount > 0 && player && player.state.status === AudioPlayerStatus.Paused) {
    // Resume playback if there are members and the player is paused
    player.unpause();
    console.log('Resumed playback');
  } else if (memberCount === 0 && player && player.state.status === AudioPlayerStatus.Playing) {
    // Pause playback if there are no members and the player is playing
    player.pause();
    console.log('Paused playback');
  }
});


async function playSong() {
  try {
    if (queue.length === 0) {
      console.log('Queue is empty. Stopping playback.');
      return;
    }

    const song = queue[currentIndex];
    console.log(`Preparing to play: ${song.title}`);

    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, { 
      inputType: stream.type,
      inlineVolume: true
    });
    resource.volume.setVolume(0.5); // Set the volume to 50%

    player.play(resource);
    console.log(`Now playing: ${song.title}`);

  } catch (error) {
    console.error('Error in playSong function:', error);
    currentIndex = (currentIndex + 1) % queue.length;
    return playSong(); // Try playing the next song
  }
}

// Modify your loadPlaylist function:
async function loadPlaylist(message, playlistUrl) {
  try {
    const playlist = await ytpl(playlistUrl);
    queue = playlist.items.map(item => ({
      title: item.title,
      url: item.url,
    }));

    message.channel.send(`Loaded ${queue.length} songs from the playlist.`);
    
    connection = await joinVoiceChannel(message);
    if (!connection) return;

    await playSong();
  } catch (error) {
    console.error('Error in loadPlaylist function:', error);
    message.channel.send('An error occurred while loading the playlist. Please try again.');
  }
}

// Add error handling for the player
player.on('error', (error) => {
  console.error('Error:', error.message);
  console.error('Error Stack:', error.stack);
  playSong().catch(console.error);
});


async function skipSong(message) {
  if (queue.length === 0) {
    return message.channel.send('The queue is empty.');
  }
  currentIndex = (currentIndex + 1) % queue.length;
  try {
    await playSong();
    message.channel.send(`Skipped to the next song: ${queue[currentIndex].title}`);
  } catch (error) {
    console.error('Error in skipSong:', error);
    message.channel.send('An error occurred while skipping the song.');
  }
}

async function previousSong(message) {
  if (queue.length === 0) {
    return message.channel.send('The queue is empty.');
  }
  currentIndex = (currentIndex - 1 + queue.length) % queue.length;
  try {
    await playSong();
    message.channel.send(`Went back to the previous song: ${queue[currentIndex].title}`);
  } catch (error) {
    console.error('Error in previousSong:', error);
    message.channel.send('An error occurred while going to the previous song.');
  }
}

player.on(AudioPlayerStatus.Playing, () => {
  console.log('The audio player has started playing!');
});

player.on(AudioPlayerStatus.Idle, () => {
  console.log('The audio player has become idle.');
});

connection.on(VoiceConnectionStatus.Ready, () => {
  console.log('The connection has entered the Ready state - ready to play audio!');
});

connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
  console.log('Connection disconnected');
  try {
    await Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
    ]);
    // Seems to be reconnecting to a new channel - ignore disconnect
  } catch (error) {
    // Seems to be a real disconnect which SHOULDN'T be recovered from
    connection.destroy();
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);