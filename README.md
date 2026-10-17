# StudyHub - AI Study Assistant 🎓

A complete, modern web-based AI study assistant built with Node.js, Express, and Google Gemini API using the official `@google/genai` SDK.

## Features

- **📊 Dashboard**: Overview of total study time, completed Pomodoro sessions, today's goal progress, and quick module navigation.
- **⏱️ Focus Mode (Pomodoro Timer)**: 25-minute focus session and 5-minute break cycles with countdown, pause, reset, audio chimes, and automatic interval transitions.
- **📄 AI PDF Workspace**: Upload PDF documents (processed via Gemini Files API) or text files (.txt, .md) or paste study notes directly.
  - **AI Summary**: Structured markdown revision summaries with Main Topic, Key Concepts, Important Definitions, Important Facts, Formulas/Processes, and Exam Revision Points.
  - **AI Doubt Solver**: Interactive Q&A chat grounded strictly in your uploaded material, explaining difficult concepts simply with examples.
- **📝 Dynamic Quiz Generator**: Generates exactly 5 multiple-choice questions (MCQs) with 4 options each, instant correctness feedback, score counter, and explanations.
- **🗂️ Study Flashcards**: Generates exactly 8 interactive flashcards featuring smooth CSS 3D flip animations to test memory and recall.
- **📈 Performance Analytics**: Displays total study time, completed sessions, and daily goal percentage (`min(100, (sessions / 2) * 100)`) with a progress bar and reset confirmation.
- **🌓 Dark Mode**: Seamless light and dark mode support with localStorage persistence.
- **📱 Fully Responsive**: Tailored for desktop, tablet, and mobile browsers using Tailwind CSS.

---

## Tech Stack

- **Frontend**: HTML5 + Tailwind CSS (via CDN) + Vanilla JavaScript (Single-page app in `public/index.html`)
- **Backend**: Node.js (ES Modules) + Express
- **AI Integration**: Google Gemini API via official `@google/genai` SDK
- **File Uploads**: Multer (up to 50 MB) + Gemini Files API
- **Client Storage**: Browser `localStorage` (no database required)

---

## Prerequisites

- **Node.js**: v18 or later (v20+ recommended)
- **npm**: v9 or later
- **Google Gemini API Key**: Obtain a key from [Google AI Studio](https://aistudio.google.com/)

---

## Installation & Setup

1. **Navigate to the project directory**:
   ```bash
   cd StudyHub
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and insert your Gemini API Key:
   ```env
   GEMINI_API_KEY=your_google_gemini_api_key_here
   GEMINI_MODEL=gemini-2.5-flash
   PORT=3000
   ```

4. **Start the Application**:
   ```bash
   npm start
   ```
   Or run in development mode with auto-reload:
   ```bash
   npm run dev
   ```

5. **Open in your browser**:
   Visit [http://localhost:3000](http://localhost:3000)

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Returns server status and configured Gemini model |
| `POST` | `/api/documents` | Accepts PDF files, text files, or pasted notes |
| `POST` | `/api/summary` | Generates a structured 6-part study summary for a document |
| `POST` | `/api/chat` | Contextual Q&A doubt solver grounded in the document |
| `POST` | `/api/quiz` | Generates 5 MCQs with 4 options, answer index, and explanation |
| `POST` | `/api/flashcards` | Generates 8 interactive study flashcards with front/back |

---

## Project Structure

```
StudyHub/
├── package.json
├── server.js
├── .env.example
├── README.md
└── public/
    └── index.html
```
