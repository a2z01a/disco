require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { 
  createAudioPlayer, createAudioResource, AudioPlayerStatus, 
  VoiceConnectionStatus, joinVoiceChannel, entersState, 
  getVoiceConnection 
} = require('@discordjs/voice');

const play = require('play-dl');
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

// Function to join the voice channel
async function jVoiceChannel(message) {
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

      // Add error handling for the player
      player.on('error', (error) => {
        console.error('Error:', error.message);
        console.error('Error Stack:', error.stack);
        playSong().catch(console.error);
      });

      player.on(AudioPlayerStatus.Playing, () => {
        console.log('The audio player has started playing!');
      });

      player.on(AudioPlayerStatus.Idle, () => {
        console.log('The audio player has become idle.');
        currentIndex = (currentIndex + 1) % queue.length;
        playSong().catch(console.error);
      });
    }

    return connection;
  } catch (error) {
    console.error('Error joining voice channel:', error);
    message.reply('Failed to join the voice channel. Please try again.');
    return null;
  }
}

// Handle voice state updates (for pausing/resuming based on member count)
client.on('voiceStateUpdate', (oldState, newState) => {
  // Check if the bot is in a voice channel
  if (!voiceChannelId) return;

  const channel = client.channels.cache.get(voiceChannelId);
  if (!channel) return;

  // Count members in the voice channel (excluding bots)
  const memberCount = channel.members.filter(member => !member.user.bot).size;

  if (memberCount > 0 && player && player.state.status === AudioPlayerStatus.Paused) {
    player.unpause();
    console.log('Resumed playback');
  } else if (memberCount === 0 && player && player.state.status === AudioPlayerStatus.Playing) {
    player.pause();
    console.log('Paused playback');
  }
});

// Play a song from the queue
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

// Load playlist function
async function loadPlaylist(message, playlistUrl) {
  try {
    const playlist = await ytpl(playlistUrl);
    queue = playlist.items.map(item => ({
      title: item.title,
      url: item.url,
    }));

    message.channel.send(`Loaded ${queue.length} songs from the playlist.`);
    
    connection = await jVoiceChannel(message);
    if (!connection) return;

    await playSong();
  } catch (error) {
    console.error('Error in loadPlaylist function:', error);
    message.channel.send('An error occurred while loading the playlist. Please try again.');
  }
}

// Skip to the next song
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

// Go back to the previous song
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

client.login(process.env.DISCORD_BOT_TOKEN);
