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
// const audioDirectory = '/Users/manushak/Downloads/Audio';

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
    const sortedFiles = sortFileNameAscending(audioFiles);

    if (sortedFiles.length === 0) {
      console.log('No audio files found in the directory.');
      return;
    }

    // Process each audio file
    for (const audioFile of sortedFiles) {
      const audioFilePath = path.join(directory, audioFile);
      console.log(`Processing file: ${audioFile}`);

      // Get data for the audio file
      await getAudioFileData(audioFilePath);
    }
  } catch (err) {
    console.error('Error processing audio files:', err);
  }
};

const sortFileNameAscending = (audioFiles) => {
  // Split the file names into name and number, then sort
  const grouped = audioFiles
    .map((file) => {
      const match = file.match(/^(\d+)\. ([\w\s]+) - (\d+)\.mp3$/); // Match the pattern
      if (match) {
        const [, index, name, number] = match;
        return { file, name, number: parseInt(number) };
      }
    })
    .filter(Boolean) // Remove invalid matches
    .reduce((acc, { file, name, number }) => {
      if (!acc[name]) acc[name] = [];
      acc[name].push({ file, number });
      return acc;
    }, {});

  // Sort the groups by number
  for (let name in grouped) {
    grouped[name].sort((a, b) => a.number - b.number); // Sort each group by the number
  }

  // Interleave the files from all groups dynamically
  let result = [];
  let iterators = Object.values(grouped).map((group) =>
    group[Symbol.iterator]()
  );

  let done = false;
  while (!done) {
    done = true;
    for (let iterator of iterators) {
      const next = iterator.next();
      if (!next.done) {
        result.push(next.value.file);
        done = false;
      }
    }
  }

  return result;
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

    headers['Content-Type'] = 'application/json';

    const requestData = {
      audio_url: uploadResponse.audio_url,
      diarization: true,
    };

    const postTranscriptionResponse = (
      await axios.post(`${GLADIA_API_URL}/transcription/`, requestData, {
        headers,
      })
    ).data;

    const audioId = postTranscriptionResponse.id;

    if (audioId) {
      await pollForResult(fileName, filePath, audioId);
    }
  } catch (err) {
    console.error(`Error fetching data for ${filePath}:`, err.message);
  }
};

async function pollForResult(fileName, filePath, audioId) {
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
      const wordTime = {};

      utterances.forEach((utterance) => {
        utterance.words.forEach((currentWord) => {
          const word = currentWord.word.trim();
          const start = currentWord.start.toFixed(2);

          wordTime[word] = start;
          text.push(word);
          startTimes.push(start);
        });
      });

      const data = {
        [fileName]: {
          ...wordTime,
          text: text.join(' '),
          startTimes: startTimes.join(' '),
        },
      };

      writeJSONFile(data, filePath);
      break;
    } else {
      console.log('Transcription status: ', pollResponse.status);
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

function writeJSONFile(data, filePath) {
  const splittedPath = filePath.split('/');
  splittedPath.pop();
  const joinedPath = splittedPath.join('/');
  const finaleFilePath = `${joinedPath}/data.json`;

  let existingData = {};
  try {
    const fileContent = fs.readFileSync(finaleFilePath, 'utf8');

    // Only parse if the file is not empty
    if (fileContent.trim()) {
      existingData = JSON.parse(fileContent);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('File does not exist, creating a new one.');
    } else {
      console.error('Error reading JSON file:', err);
    }
  }

  // Merge the new data with the existing data (adjust this according to your use case)
  const updatedData = { ...existingData, ...data };

  // Write the updated data back to the JSON file
  fs.writeFileSync(finaleFilePath, JSON.stringify(updatedData, null, 2));

  console.log(`Data saved to ${finaleFilePath} successfully`);
}

processAudioFiles(audioDirectory);
