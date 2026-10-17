import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODEL_NAME = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash';

// Ensure uploads temporary directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage configuration for up to 50MB uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isPdf = file.mimetype === 'application/pdf' || ext === '.pdf';
    const isText = file.mimetype.startsWith('text/') ||
                   ['.txt', '.md', '.markdown', '.json', '.csv', '.rtf'].includes(ext);

    if (isPdf || isText) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Please upload a PDF or text document (.txt, .md).'));
    }
  }
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory document storage: Map<documentId, DocumentRecord>
// DocumentRecord: { id, name, type: 'pdf'|'text', fileUri?, mimeType?, text?, createdAt }
const documents = new Map();

// Helper to initialize GoogleGenAI client
function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.trim() === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured. Please add your Gemini API key to the StudyHub/.env file.');
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

function isUnavailableError(error) {
  return error?.code === 503 ||
    error?.status === 'UNAVAILABLE' ||
    error?.message?.includes('currently experiencing high demand');
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Helper to interact with Gemini models using @google/genai SDK
async function generateWithGemini(doc, promptText, jsonMode = false) {
  const ai = getAIClient();
  const configuredModel = process.env.GEMINI_MODEL || MODEL_NAME;
  const models = [...new Set([configuredModel, FALLBACK_MODEL_NAME])];

  let contents;
  if (doc.type === 'pdf') {
    contents = [
      {
        fileData: {
          fileUri: doc.fileUri,
          mimeType: doc.mimeType || 'application/pdf',
        },
      },
      promptText,
    ];
  } else {
    contents = [
      `Document Name: "${doc.name}"\n\nDocument Content:\n${doc.text}\n\n---\nInstruction:\n${promptText}`
    ];
  }

  const config = {};
  if (jsonMode) {
    config.responseMimeType = 'application/json';
  }

  let lastError;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: Object.keys(config).length > 0 ? config : undefined,
        });

        return response.text;
      } catch (error) {
        lastError = error;
        if (!isUnavailableError(error)) {
          throw error;
        }
        await wait(500 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

// Helper to parse JSON output safely
function parseJsonSafely(raw) {
  if (!raw) throw new Error('Empty response received from AI model');
  let clean = raw.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return JSON.parse(clean.trim());
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    model: MODEL_NAME
  });
});

// Multer upload wrapper middleware
const uploadMiddleware = (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds maximum limit of 50 MB.' });
        }
        return res.status(400).json({ error: `File upload error: ${err.message}` });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  } else {
    next();
  }
};

// 2. Documents upload & ingestion
app.post('/api/documents', uploadMiddleware, async (req, res) => {
  try {
    const docId = `doc_${crypto.randomUUID()}`;

    // Case A: Multipart file upload (PDF or text)
    if (req.file) {
      const filePath = req.file.path;
      const originalName = req.file.originalname;
      const ext = path.extname(originalName).toLowerCase();
      const isPdf = req.file.mimetype === 'application/pdf' || ext === '.pdf';

      if (isPdf) {
        try {
          const ai = getAIClient();
          // Upload PDF directly to Gemini Files API
          const uploadResult = await ai.files.upload({
            file: filePath,
            mimeType: 'application/pdf',
          });

          // Remove local temporary file
          await fs.promises.unlink(filePath).catch(() => {});

          documents.set(docId, {
            id: docId,
            name: originalName,
            type: 'pdf',
            fileUri: uploadResult.uri,
            mimeType: uploadResult.mimeType || 'application/pdf',
            createdAt: Date.now()
          });

          return res.json({
            documentId: docId,
            name: originalName,
            type: 'pdf'
          });
        } catch (uploadErr) {
          // Clean up file if still exists
          await fs.promises.unlink(filePath).catch(() => {});
          throw uploadErr;
        }
      } else {
        // Text / markdown file
        const textContent = await fs.promises.readFile(filePath, 'utf8');
        await fs.promises.unlink(filePath).catch(() => {});

        if (!textContent || textContent.trim().length === 0) {
          return res.status(400).json({ error: 'Uploaded text file is empty.' });
        }

        documents.set(docId, {
          id: docId,
          name: originalName,
          type: 'text',
          text: textContent,
          createdAt: Date.now()
        });

        return res.json({
          documentId: docId,
          name: originalName,
          type: 'text'
        });
      }
    }

    // Case B: Pasted text via JSON or form body
    const pastedText = req.body.text;
    const documentName = req.body.name || `Pasted Notes (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;

    if (pastedText && pastedText.trim().length > 0) {
      documents.set(docId, {
        id: docId,
        name: documentName,
        type: 'text',
        text: pastedText.trim(),
        createdAt: Date.now()
      });

      return res.json({
        documentId: docId,
        name: documentName,
        type: 'text'
      });
    }

    return res.status(400).json({
      error: 'Please upload a PDF or text file, or paste your study material.'
    });
  } catch (error) {
    console.error('Error handling document ingestion:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process document.'
    });
  }
});

// 3. AI Summary
app.post('/api/summary', async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required.' });
    }

    const doc = documents.get(documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found or expired. Please upload your study material again.' });
    }

    const summaryPrompt = `You are an expert academic tutor. Analyze the provided study material thoroughly and generate a comprehensive, structured revision summary based ONLY on the uploaded document.
Do not invent or assume information that is not directly supported by the source text.

Structure your response clearly using the following markdown sections:

### 📌 Main Topic
A concise 1-2 sentence overview of the subject matter.

### 💡 Key Concepts
Bulleted explanations of the primary ideas, theories, or principles discussed.

### 📖 Important Definitions
Bulleted list of critical terminology and their precise definitions according to the text.

### ⚡ Important Facts
Key data points, discoveries, timeline milestones, or crucial facts highlighted in the material.

### 📐 Important Formulas or Processes
Key formulas, equations, methods, or step-by-step processes described. If none appear in the text, clearly state "No explicit formulas or multi-step processes are mentioned in this document."

### 🎯 Exam Revision Points
High-yield bullet points optimized for quick student review before an exam.`;

    const summaryText = await generateWithGemini(doc, summaryPrompt, false);
    return res.json({ text: summaryText });
  } catch (error) {
    console.error('Error in /api/summary:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate study summary.'
    });
  }
});

// 4. AI Doubt Solver / Chat
app.post('/api/chat', async (req, res) => {
  try {
    const { documentId, question } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required.' });
    }
    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question cannot be empty.' });
    }

    const doc = documents.get(documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found or expired. Please upload your study material again.' });
    }

    const chatPrompt = `You are a supportive, knowledgeable AI academic tutor answering a student's question based on their uploaded study material.

Rules:
1. Explain difficult concepts simply and clearly.
2. Give concrete examples whenever helpful.
3. Stay strictly focused on the uploaded material.
4. If the document does not contain enough information to answer the question, clearly state: "The uploaded study material does not contain enough information to answer this question."
5. Do not fabricate, hallucinate, or speculate outside the document.

Student's Question:
"${question.trim()}"`;

    const answerText = await generateWithGemini(doc, chatPrompt, false);
    return res.json({ answer: answerText });
  } catch (error) {
    console.error('Error in /api/chat:', error);
    return res.status(500).json({
      error: error.message || 'Failed to answer student doubt.'
    });
  }
});

// 5. Dynamic Quiz Generator (Exactly 5 MCQs)
app.post('/api/quiz', async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required.' });
    }

    const doc = documents.get(documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found or expired. Please upload your study material again.' });
    }

    const quizPrompt = `Generate a 5-question multiple choice quiz based strictly on the provided study material.

Requirements:
- Exactly 5 questions covering different concepts from the document.
- Exactly 4 distinct options per question.
- "answer" must be the zero-based index of the correct option (0, 1, 2, or 3).
- Every question must include a clear, educational explanation.
- Must be based only on the uploaded document.

Return ONLY valid JSON matching this exact structure:
{
  "questions": [
    {
      "question": "Question text here",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "answer": 0,
      "explanation": "Explanation for why this answer is correct"
    }
  ]
}`;

    const rawOutput = await generateWithGemini(doc, quizPrompt, true);
    const parsed = parseJsonSafely(rawOutput);

    // Normalize questions array
    let questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);

    // Ensure questions format meets rules
    questions = questions.slice(0, 5).map((q, idx) => {
      const opts = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
      while (opts.length < 4) {
        opts.push(`Option ${String.fromCharCode(65 + opts.length)}`);
      }
      let ans = typeof q.answer === 'number' ? Math.floor(q.answer) : parseInt(q.answer, 10);
      if (isNaN(ans) || ans < 0 || ans > 3) ans = 0;
      return {
        question: q.question || `Question ${idx + 1}`,
        options: opts,
        answer: ans,
        explanation: q.explanation || 'Explanation provided by StudyHub AI.'
      };
    });

    return res.json({ questions });
  } catch (error) {
    console.error('Error in /api/quiz:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate quiz.'
    });
  }
});

// 6. Flashcards Generator (Exactly 8 Flashcards)
app.post('/api/flashcards', async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required.' });
    }

    const doc = documents.get(documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found or expired. Please upload your study material again.' });
    }

    const flashcardsPrompt = `Generate exactly 8 study flashcards based strictly on the provided study material.

Requirements:
- Exactly 8 cards.
- "front" must contain a focused question, key concept, or term.
- "back" must contain a concise, clear answer or definition based on the text.
- Must be based only on the uploaded document.

Return ONLY valid JSON matching this exact structure:
{
  "cards": [
    {
      "front": "Question or concept",
      "back": "Answer"
    }
  ]
}`;

    const rawOutput = await generateWithGemini(doc, flashcardsPrompt, true);
    const parsed = parseJsonSafely(rawOutput);

    let cards = Array.isArray(parsed) ? parsed : (parsed.cards || []);

    // Ensure exactly 8 cards
    cards = cards.slice(0, 8).map((c, idx) => ({
      front: c.front || `Concept ${idx + 1}`,
      back: c.back || 'Definition or explanation from the study material.'
    }));

    return res.json({ cards });
  } catch (error) {
    console.error('Error in /api/flashcards:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate flashcards.'
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: err.message || 'Internal server error occurred.'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`StudyHub AI Assistant server running on http://localhost:${PORT}`);
  console.log(`Gemini Model configured: ${MODEL_NAME}`);
});
