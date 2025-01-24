import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';

dotenv.config();

// Set up the Gladia API URL and API key
const GLADIA_API_URL = 'https://api.gladia.io/v2';
const API_KEY = process.env.GLADIA_API_KEY;

// Get the audio directory from command-line arguments
const audioDirectory = process.argv[2];

if (!audioDirectory) {
  console.log('Please provide the directory path as an argument.');
  process.exit(1);
}

// const audioDirectory = '/Users/manushak/Desktop/audio';

// Function to process audio files in the directory
const processAudioFiles = async (directory) => {
  try {
    // Check if the directory exists
    if (!fs.existsSync(directory)) {
      console.log(`The directory "${directory}" does not exist.`);
      return;
    }

    // Read the contents of the directory
    const files = fs.readdirSync(directory);

    // Filter out audio files (you can adjust based on your formats)
    const audioFiles = files.filter((file) => /\.(mp3|wav|flac)$/i.test(file));

    if (audioFiles.length === 0) {
      console.log('No audio files found in the directory.');
      return;
    }

    // Process each audio file
    for (const audioFile of audioFiles) {
      const audioFilePath = path.join(directory, audioFile);
      console.log(`Processing file: ${audioFile}`);

      // Get data for the audio file
      await getAudioFileData(audioFilePath);
    }
  } catch (err) {
    console.error('Error processing audio files:', err);
  }
};

// Function to get data for each audio file from the Gladia API
const getAudioFileData = async (filePath) => {
  try {
    const form = new FormData();
    form.append('audio', fs.createReadStream(filePath), {
      contentType: 'audio/wav',
    });
    const headers = {
      'x-gladia-key': API_KEY,
    };

    const uploadResponse = (
      await axios.post(`${GLADIA_API_URL}/upload/`, form, {
        headers: {
          ...form.getHeaders(),
          ...headers,
        },
      })
    ).data;
    const fileName = uploadResponse.audio_metadata.filename;

    console.log(`Data for ${filePath}:`, uploadResponse);

    headers['Content-Type'] = 'application/json';

    const requestData = {
      audio_url: uploadResponse.audio_url,
      diarization: true,
    };

    console.log('- Sending post transcription request to Gladia API...');

    const postTranscriptionResponse = (
      await axios.post(`${GLADIA_API_URL}/transcription/`, requestData, {
        headers,
      })
    ).data;

    console.log(
      'Initial response with Transcription ID:',
      postTranscriptionResponse
    );

    const audioId = postTranscriptionResponse.id;

    if (audioId) {
      await pollForResult(fileName, audioId);
    }
  } catch (err) {
    console.error(`Error fetching data for ${filePath}:`, err.message);
  }
};

async function pollForResult(fileName, audioId) {
  while (true) {
    console.log('Polling for results...');
    const pollResponse = (
      await axios.get(`${GLADIA_API_URL}/pre-recorded/${audioId}`, {
        headers: {
          'x-gladia-key': API_KEY,
        },
      })
    ).data;

    if (pollResponse.status === 'done') {
      console.log('- Transcription done: \n ');

      const utterances = pollResponse.result.transcription.utterances;
      const startTimes = [];
      const text = [];

      utterances.forEach((utterance) => {
        text.push(utterance.text);

        if (utterance.words.length > 1) {
          const nestedWordsTimes = [];

          utterance.words.forEach((word) => {
            nestedWordsTimes.push(word.start);
          });

          startTimes.push(nestedWordsTimes);
        } else {
          startTimes.push(utterance.start);
        }
      });

      const data = {
        [fileName]: {
          startTimes,
          text,
        },
      };

      writeJSONFile(data);
      break;
    } else {
      console.log('Transcription status: ', pollResponse.status);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

function writeJSONFile(data) {
  const filePath = 'data.json';

  // Convert the data to a JSON string and write it to the file (creates file if it doesn't exist)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  console.log(`Data saved to ${filePath} successfully`);
}

processAudioFiles(audioDirectory);
