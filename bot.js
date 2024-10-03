require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytpl = require('ytpl');
const play = require('play-dl');

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

  // Check if the user is in a voice channel
  if (!message.member.voice.channel) {
    return message.reply("You need to be in a voice channel to use this command!");
  }

  try {
    if (command === 'play') {
      await loadPlaylist(message, args[0]);
    } else if (command === 'skip') {
      await skipSong(message);
    } else if (command === 'previous') {
      await previousSong(message);
    }
  } catch (error) {
    console.error(`Error executing command ${command}:`, error);
    message.reply('An error occurred while executing the command.');
  }
});

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
        playSong().catch(console.error);
      });
    }

    await playSong();
  } catch (error) {
    console.error('Error in loadPlaylist function:', error);
    message.channel.send('An error occurred while loading the playlist. Please try again.');
  }
}

async function playSong() {
  try {
    if (queue.length === 0) {
      console.log('Queue is empty. Stopping playback.');
      return;
    }

    const song = queue[currentIndex];
    console.log(`Preparing to play: ${song.title}`);

    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    
    player.play(resource);
    console.log(`Now playing: ${song.title}`);

  } catch (error) {
    console.error('Error in playSong function:', error);
    currentIndex = (currentIndex + 1) % queue.length;
    return playSong(); // Try playing the next song
  }
}

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

client.login(process.env.DISCORD_BOT_TOKEN);