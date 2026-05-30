require('./env'); 
const { OpenAI } = require('openai');

const apiKey = process.env.OPENAI_API_KEY || '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';

if (!process.env.OPENAI_API_KEY && apiKey === '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') {
  console.warn(' Attention : OPENAI_API_KEY lue depuis la clé de secours en dur.');
}

const openai = new OpenAI({
  apiKey: apiKey, 
});

module.exports = openai;