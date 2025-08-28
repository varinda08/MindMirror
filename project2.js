// Usage:
//   npm i @google/generative-ai mongoose dotenv
//   set GEMINI_API_KEY=your_key
//   set TAVILY_API_KEY=your_key
//   set MONGODB_URI=your_connection_string
//   node project2.js "I have a great idea for a new mobile app for dog walkers."

require('dotenv').config(); 

// Fix: import from correct package
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'ai_workshop';

// Create a simple idea schema - this is like a template for our data
const ideaSchema = new mongoose.Schema({
  summary: String,      // Short description of the idea
  tags: [String],       // List of tags (keywords)
  related: [            // List of related information from the web
    {
      title: String,    // Title of the webpage
      url: String,      // Link to the webpage
      summary: String   // Brief text from the webpage
    }
  ],
  createdAt: {          // When the idea was saved
    type: String,
    default: () => new Date().toISOString()
  }
});


// Create a model from our schema - this is how we interact with MongoDB
const Idea = mongoose.model('Idea', ideaSchema);


// 1) Get idea text
const ideaText = process.argv.slice(2).join(' ').trim();
if (!ideaText) {
  console.error('Please provide your idea. Example: node project2.js "New mobile app for dog walkers"');
  process.exit(1);
}

// 2) Search Tavily for related info (simple)
async function searchTavily(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: 'basic',
      max_results: 3
    })
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const items = Array.isArray(data.results) ? data.results : [];
  // Keep only what we need
  return items.map(r => ({
    title: r.title || 'Untitled',
    url: r.url,
    summary: (r.content || '').slice(0, 300)
  }));
}

// 3) Ask Gemini to extract summary + tags (very simple)
async function extractSummaryAndTags(idea, related) {
  // Create a new instance of the Google Generative AI client
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const relatedText = related.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.summary}`).join('\n\n');

  const prompt = `
You extract a short summary and 3-5 simple tags.
Return ONLY JSON like: {"summary":"...", "tags":["tag1","tag2"]}
Do not use markdown formatting in your response.

Idea:
${idea}

Related info:
${relatedText}
`.trim();

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();
  
  // Clean up the response if it contains markdown code blocks
  if (text.includes('```')) {
    // Remove markdown code block markers
    text = text.replace(/```(json|javascript)?\n/g, '');
    text = text.replace(/```/g, '');
  }
  
  // Remove any extra whitespace
  text = text.trim();
  
  try {
    // Parse the JSON
    return JSON.parse(text);
  } catch (error) {
    console.error("Failed to parse JSON response:", text);
    // Return a fallback response
    return {
      summary: idea,
      tags: ["unclassified"]
    };
  }
}

// 4) Save to MongoDB - simplified version with mongoose
async function save_idea_to_db(summary, tags, related) {
  try {
    // Connect to the database
    await mongoose.connect(MONGODB_URI, {
      dbName: MONGODB_DB
    });
    
    // Create a new idea using our model
    const newIdea = new Idea({
      summary: summary,
      tags: tags,
      related: related
    });
    
    // Save it to the database
    const savedIdea = await newIdea.save();
    
    // Close the connection
    await mongoose.connection.close();
    
    // Return the ID of the saved idea
    return savedIdea._id;
  } catch (error) {
    console.error('Database error:', error.message);
    throw error;
  }
}

// 5) Main
(async () => {
  try {
    const related = await searchTavily(ideaText);
    const { summary, tags } = await extractSummaryAndTags(ideaText, related);
    const id = await save_idea_to_db(summary, tags, related);
    console.log('Saved idea:', { id, summary, tags });
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
