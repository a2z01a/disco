require('dotenv').config();
const { 
  createAudioPlayer, createAudioResource, AudioPlayerStatus, 
  VoiceConnectionStatus, joinVoiceChannel, entersState 
} = require('@discordjs/voice');
const { exec } = require('child_process');
const { Client, GatewayIntentBits } = require('discord.js');


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
        console.error('Playback error:', error.message);
  console.error('Error details:', error);
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

// Message handler for commands
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'play') {
    const playlistUrl = args[0];
    if (!playlistUrl) {
      return message.reply('Please provide a playlist URL.');
    }

    console.log(`Received command to play: ${playlistUrl}`);
    await loadPlaylist(message, playlistUrl);
  }

  if (command === 'skip') {
    console.log('Skipping to the next song...');
    await skipSong(message);
  }

  if (command === 'previous') {
    console.log('Going back to the previous song...');
    await previousSong(message);
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

    // Use yt-dlp to download the stream
    const ytDlpCommand = `yt-dlp --username oauth2 --password '' -f bestaudio -o - ${song.url}`;
    const stream = exec(ytDlpCommand, { shell: true });

    stream.stdout.on('data', (data) => {
      const resource = createAudioResource(data, {
        // inputType: AudioResourceType.Arbitrary, // Use AudioResourceType
        inlineVolume: true
      });
      resource.volume.setVolume(1); // Set the volume to 100%
      player.play(resource);
      console.log(`Now playing: ${song.title}`);
    });

    stream.stderr.on('data', (error) => {
      console.error('Error streaming audio:', error);
    });
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
    console.log(`Loaded ${queue.length} songs from the playlist.`);

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


