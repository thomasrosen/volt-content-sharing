const amountOfColumnsToEmbed = 7;
const embeddingColumn = 8; // The embeddings are stored in column 8
const publishedColumn = 9; // The published-boolean is stored in column 9

// Mapping of spreadsheet column headers to API-friendly field names
const columnNameMap = {
  'Timestamp': 'timestamp',
  'Upload Video': 'video_id',
  'Description': 'description',
  'Main language of the video': 'language',
  'Licence': 'licence',
  'Who is in the video?': 'actors'
};

function onFormSubmit(e) {
  try {
    var sheet = e.range.getSheet();
    var row = e.range.getRow();
    var numColumns = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, numColumns).getValues()[0];
    var data = sheet.getRange(row, 1, 1, numColumns).getValues()[0];

    // Load shared drive folder ID from script properties
    var scriptProperties = PropertiesService.getScriptProperties();
    var sharedDriveFolderId = scriptProperties.getProperty('SHARED_DRIVE_FOLDER_ID');
    if (!sharedDriveFolderId) {
      Logger.log('Shared drive folder ID not set in script properties.');
      return;
    }

    // Find the index of the file upload column
    var fileUploadColumnIndex = headers.indexOf('Upload Video');
    if (fileUploadColumnIndex === -1) {
      Logger.log('File upload column not found');
      return;
    }

    var fileUrls = data[fileUploadColumnIndex];

    if (!fileUrls) {
      Logger.log('No file uploaded');
      return;
    }

    // Extract the file ID from the URL
    var fileId = extractFileId(fileUrls);

    if (!fileId) {
      Logger.log('Could not extract file ID');
      return;
    }

    // Use Drive API to move the file to the shared drive folder
    var fileResource = Drive.Files.get(fileId, { fields: 'parents', supportsAllDrives: true });
    var previousParents = fileResource.parents ? fileResource.parents.join(',') : null;

    Drive.Files.update({}, fileId, null, {
      addParents: sharedDriveFolderId,
      removeParents: previousParents,
      supportsAllDrives: true
    });

    // Make the file publicly viewable
    var permission = {
      'type': 'anyone',
      'role': 'reader',
      'withLink': true
    };
    Drive.Permissions.create(permission, fileId, {
      sendNotificationEmails: false,
      supportsAllDrives: true,
    });

    // Update the sheet with the file ID instead of the URL
    sheet.getRange(row, fileUploadColumnIndex + 1).setValue(fileId);

    // Optionally, you can add a note indicating the file has been moved and made public
    sheet.getRange(row, fileUploadColumnIndex + 1).setNote('File moved to shared drive and made public');

    recalcEmbbedings(e);

  } catch (error) {
    Logger.log('Error: ' + error.toString());
  }
}

function extractFileId(url) {
  var match = url.match(/[-\w]{25,}/);
  return (match && match[0]) || null;
}

function outputJSON(data) {
  /*
  const output = ContentService.createTextOutput();
  //output.setMimeType(ContentService.MimeType.JSON);
  output.setContent(JSON.stringify(data));
  // output.addHeader("Access-Control-Allow-Origin", "https://thomasrosen.github.io"); // Set CORS headers
  //output.addHeader("Access-Control-Allow-Origin", "*"); // Set CORS headers
  output.addHeader("Access-Control-Allow-Origin", "*");
  output.addHeader("Content-Type", "application/json");
  */

  /*
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  */
  
  // output.addHeader("Access-Control-Allow-Origin", "*");
  // output.addHeader("Content-Type", "application/json");

  // return output

  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(props = {}) {
  const parameter = props.parameter || {}
  const action = parameter.action

  if (typeof action === 'string') {
    if (action === 'searchEmbeddings') {
      const query = parameter.query
      const amount = parameter.amount
      const data = { query, results: searchEmbeddings(query, amount) }
      return outputJSON(data)
    } else if (action === 'search') {
      // Extract parameters
      const query = parameter.query || '';
      const amount = parseInt(parameter.amount) || 10;
      const page = parseInt(parameter.page) || 1;
      const sortBy = parameter.sortBy || 'date';
      const sortOrder = parameter.sortOrder || 'desc'; // 'asc' or 'desc'

      const data = {
        results: searchVideos(query, amount, page, sortBy, sortOrder)
      };
      return outputJSON(data)
    }
  }
  
  return HtmlService.createHtmlOutputFromFile('index');
}

function testEmbbeding() {
  const result = getOpenAIEmbedding('hello world')
}

// Function to generate embeddings using OpenAI API
function getOpenAIEmbedding(text) {
  if (!text) {
    return null; // No text to embed
  }
  if (text.length === 0) {
    return null; // No text to embed
  }

  // First, check the cache
  const cachedEmbedding = getCachedEmbedding(text);
  if (cachedEmbedding) {
    return cachedEmbedding;
  }

  const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not found. Please set it in Script Properties.');
  }

  const url = 'https://api.openai.com/v1/embeddings';
  const payload = {
    input: text,
    model: 'text-embedding-ada-002'
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());
    if (data.error) {
      console.error(`OpenAI API Error: ${data.error.message}`);
      return null;
    }

    const embedding = data.data[0].embedding;

    // Store the embedding in the cache
    cacheEmbedding(text, embedding);

    return embedding;
  } catch (error) {
    console.error(`Error generating embedding: ${error}`);
    return null;
  }
}

// Function to get an embedding from the cache
function getCachedEmbedding(text) {
  const cacheSheet = getEmbeddingCacheSheet();
  const dataRange = cacheSheet.getDataRange();
  const values = dataRange.getValues();

  for (let i = 1; i < values.length; i++) { // Start from row 2 to skip headers
    if (values[i][0] === text) {
      // Found the text in the cache
      try {
        const embedding = JSON.parse(values[i][1]);
        return embedding;
      } catch (error) {
        console.error(`Error parsing cached embedding: ${error}`);
        return null;
      }
    }
  }
  return null; // Not found in cache
}

// Function to cache a new embedding
function cacheEmbedding(text, embedding) {
  const cacheSheet = getEmbeddingCacheSheet();
  cacheSheet.appendRow([text, JSON.stringify(embedding)]);
}

// Helper function to get the cache sheet
function getEmbeddingCacheSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cacheSheet = ss.getSheetByName('EmbeddingCache');
  if (!cacheSheet) {
    // Create the cache sheet if it doesn't exist
    cacheSheet = ss.insertSheet('EmbeddingCache');
    // Set headers
    cacheSheet.getRange(1, 1).setValue('Text');
    cacheSheet.getRange(1, 2).setValue('Embedding');
  }
  return cacheSheet;
}

function testSearch() {
  const result = searchEmbeddings('video', 10)
  console.log(result)
}

/*
function getAllVideos(amount = 10) {

  if (typeof amount !== 'number') {
    amount = 10
  }
  if (amount > 100) {
    amount = 100
  }
  if (amount < 1) {
    amount = 1
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // Extract headers from the first row
  const forbiddenColumns = ['Contact', 'Embedding']
  const headers = values[0].filter(header => !forbiddenColumns.includes(header))

  const results = [];

  for (let i = 1; i < values.length; i++) { // Skip header row
    const row = values[i];

    // Create an object with headers as keys
    const rowObject = {};
    headers.forEach((header, index) => {
      rowObject[header] = row[index];
    });

    // Store similarity and row data
    results.push(rowObject);
  }

  // Return top N results as objects
  return results.slice(0, amount);
}
*/

// Combined search function for videos
function searchVideos(query, amount = 10, page = 1, sortBy = 'date', sortOrder = 'desc') {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // Extract headers from the first row
  const forbiddenColumns = ['Contact', 'Embedding'];
  const headers = values[0];
  const allowedHeaders = headers.filter(header => !forbiddenColumns.includes(header));

  const results = [];

  const queryExists = query && typeof query === 'string' && query.trim().length > 0;
  let queryEmbedding = null;

  if (queryExists) {
    // Generate query embedding
    queryEmbedding = getOpenAIEmbedding(query);
    if (!queryEmbedding) {
      return [];
    }
  }

  for (let i = 1; i < values.length; i++) { // Skip header row
    const row = values[i];
    const rowObject = {};
    allowedHeaders.forEach((header, index) => {
      const apiFieldName = columnNameMap[header] || header.replace(/\s+/g, '_').toLowerCase();
      rowObject[apiFieldName] = row[index];
    });

    if (queryExists) {
      const publishedBoolean = row[publishedColumn - 1]; // Published boolean is in column 9
      if (publishedBoolean !== 'YES') {
        continue; // Skip as not published
      }

      const embeddingJSON = row[embeddingColumn - 1]; // Embedding is in column 8
      if (!embeddingJSON) {
        continue; // Skip if no embedding
      }

      let embedding;
      try {
        embedding = JSON.parse(embeddingJSON);
      } catch (error) {
        console.error(`Error parsing embedding JSON for row ${i + 1}: ${error}`);
        continue;
      }

      // Calculate similarity
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      rowObject['similarity'] = similarity;

      // Only include results with similarity above threshold
      // const similarityThreshold = 0.5; // Adjust as needed or make it a parameter
      // if (similarity < similarityThreshold) {
      //   continue; // Skip this result
      // }
    }

    results.push(rowObject);
  }

  // Sorting
  if (sortBy === 'date') {
    results.sort((a, b) => {
      const dateA = new Date(a['date']);
      const dateB = new Date(b['date']);
      if (sortOrder === 'asc') {
        return dateA - dateB;
      } else {
        return dateB - dateA;
      }
    });
  } else if (sortBy === 'similarity' && queryExists) {
    results.sort((a, b) => {
      if (sortOrder === 'asc') {
        return a.similarity - b.similarity;
      } else {
        return b.similarity - a.similarity;
      }
    });
  }

  // Pagination
  const startIndex = (page - 1) * amount;
  const paginatedResults = results.slice(startIndex, startIndex + amount);

  return paginatedResults;
}


function searchEmbeddings(query, amount = 10) {
  
  if (!query || typeof query !== 'string') {
    return [];
  }

  if (typeof amount !== 'number') {
    amount = 10
  }
  if (amount > 100) {
    amount = 100
  }
  if (amount < 1) {
    amount = 1
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // Extract headers from the first row
  const forbiddenColumns = ['Contact', 'Embedding']
  const headers = values[0].filter(header => !forbiddenColumns.includes(header))

  const queryEmbedding = getOpenAIEmbedding(query);
  if (!queryEmbedding) {
    return [];
  }

  const results = [];

  for (let i = 1; i < values.length; i++) { // Skip header row
    const row = values[i];

    const publishedBoolean = row[publishedColumn - 1]; // Published boolean is in column 9
    if (publishedBoolean !== 'YES') {
      continue; // Skip as not published
    }

    const embeddingJSON = row[embeddingColumn - 1]; // Embedding is in column 8
    if (!embeddingJSON) {
      continue;
    }

    let embedding;
    try {
      embedding = JSON.parse(embeddingJSON);
    } catch (error) {
      console.error(`Error parsing embedding JSON for row ${i + 1}: ${error}`);
      continue;
    }

    // Calculate similarity
    const similarity = cosineSimilarity(queryEmbedding, embedding);

    // Create an object with headers as keys
    const rowObject = {};
    headers.forEach((header, index) => {
      // if (index < embeddingColumn - 1) {
        rowObject[header] = row[index];
      // }
    });

    // Store similarity and row data
    results.push({ similarity, row: rowObject });
  }

  // Sort results by similarity in descending order
  results.sort((a, b) => b.similarity - a.similarity);

  // Return top N results as objects
  return results.slice(0, amount).map(result => result.row);
}

// Function to calculate cosine similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) {
    return 0
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Automatic embedding generation when data is edited or added
function recalcEmbbedings(e) {
  const range = e.range;
  const sheet = range.getSheet();
  if (sheet.getName() !== 'Form Responses') {
    return;
  }

  const row = range.getRow();
  const col = range.getColumn();

  if (row === 1) {
    return; // Skip header row
  }

  if (col >= 1 && col <= amountOfColumnsToEmbed) { // If edit is in columns to embed
    const embeddingCell = sheet.getRange(row, embeddingColumn);
    embeddingCell.setValue(''); // Clear existing embedding

    const headers = sheet.getRange(1, 1, 1, amountOfColumnsToEmbed).getValues()[0];
    const rowData = sheet.getRange(row, 1, 1, amountOfColumnsToEmbed).getValues()[0];

    // Create an object with headers as keys
    const rowObject = {};
    headers.forEach((header, index) => {
      rowObject[header] = rowData[index];
    });

    // Generate text for embedding
    const pureText = rowData.join(' ').replace(/\s+/g, ' ').trim();
    if (pureText.length === 0) {
      return;
    }

    const textToEmbed = JSON.stringify(rowObject)
    const embedding = getOpenAIEmbedding(textToEmbed);
    if (embedding) {
      embeddingCell.setValue(JSON.stringify(embedding));
    } else {
      console.error(`Failed to generate embedding for row ${row}`);
    }
  }
}

function onEdit(e) {
  return recalcEmbbedings(e)
}
