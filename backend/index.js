import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

const ai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const chatModel = process.env.OPENROUTER_MODEL || "openai/gpt-4o";
const navigationMaxTokens = Number(process.env.OPENROUTER_NAVIGATION_MAX_TOKENS) || 2048;
const transcriptionModel = process.env.OPENROUTER_STT_MODEL || "openai/whisper-large-v3";
const speechModel = process.env.OPENROUTER_TTS_MODEL || "openai/gpt-4o-mini-tts-2025-12-15";

// ==================================================
// PATHS
// ==================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================================================
// LOAD NAVIGATION GRAPH
// ==================================================

const navigationGraph = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "graph.json"),
    "utf8"
  )
);

// ==================================================
// HELPERS
// ==================================================

function getMimeType(fileName) {
  const extension = path.extname(fileName).toLowerCase();

  const mimeTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };

  return mimeTypes[extension];
}

// Convert raw PCM from OpenRouter TTS into a WAV file
function pcmToWav(
  pcmBuffer,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16
) {
  const header = Buffer.alloc(44);

  const byteRate =
    sampleRate * channels * (bitsPerSample / 8);

  const blockAlign =
    channels * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);

  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([
    header,
    pcmBuffer,
  ]);
}

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    return JSON.parse(cleaned);
  }
}

function providerErrorResponse(error, fallbackMessage) {
  const status = Number(error.status);

  if (status === 402) {
    return {
      status,
      error: fallbackMessage,
      details: "OpenRouter rejected the request because the account or API key needs available credit. Check your OpenRouter credits and key spending limit, then try again.",
    };
  }

  if (status === 429) {
    return {
      status,
      error: fallbackMessage,
      details: "OpenRouter's request limit was reached. Please try again later.",
    };
  }

  if (status === 503) {
    return {
      status,
      error: fallbackMessage,
      details: "The AI service is temporarily busy. Please try again in a few moments.",
    };
  }

  return {
    status: status >= 400 && status <= 599 ? status : 500,
    error: fallbackMessage,
    details: error.message,
  };
}

// ==================================================
// 1. VOICE -> TEXT
// ==================================================

async function transcribeAudio(file) {
  const base64Audio =
    file.buffer.toString("base64");

  const format = file.mimetype.includes("mp4") ? "mp4" : "webm";
  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: transcriptionModel,
      input_audio: { data: base64Audio, format },
    }),
  });
  if (!response.ok) {
    const error = new Error(`Transcription failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const result = await response.json();
  return result.text.trim();
}

// ==================================================
// 2. IMAGE + REQUEST + GRAPH -> NAVIGATION
// ==================================================

async function getNavigation({
  imageName,
  message,
}) {
  const safeImageName =
    path.basename(imageName);

  const imagePath = path.join(
    __dirname,
    "images",
    safeImageName
  );

  if (!fs.existsSync(imagePath)) {
    throw new Error(
      `Image '${safeImageName}' was not found`
    );
  }

  const mimeType =
    getMimeType(safeImageName);

  if (!mimeType) {
    throw new Error(
      "Unsupported image type"
    );
  }

  const imageBuffer =
    fs.readFileSync(imagePath);

  const base64Image =
    imageBuffer.toString("base64");

  const prompt = `
אתה סוכן תמיכה חכם ומדויק של מערכת טלוויזיה.

אתה מקבל שלושה מקורות מידע:

1. צילום מסך של המסך שבו המשתמש נמצא כרגע.
2. בקשה של המשתמש בשפה טבעית.
3. גרף ניווט שמכיל את המסכים, הפעולות והמעברים האפשריים במערכת.

המטרה שלך היא להדריך את המשתמש בצורה מדויקת, מפורטת וברורה מהמסך הנוכחי אל היעד שהוא מבקש.

==================================================
שלב 1 - זיהוי המסך הנוכחי
==================================================

נתח את צילום המסך.

זהה את המסך המתאים ביותר מתוך המסכים שקיימים בגרף.

השתמש בפרטים הנראים בתמונה כגון:
- כותרת המסך
- תפריט
- כפתורים
- אייקונים
- טקסטים
- האפשרות המסומנת כרגע
- מבנה המסך

אל תמציא שם של מסך שאינו קיים בגרף.

==================================================
שלב 2 - הבנת בקשת המשתמש
==================================================

הבן מה המשתמש באמת רוצה לבצע.

לדוגמה:

"אני רוצה לראות נטפליקס"

הכוונה היא לא רק לענות "פתח Netflix",
אלא לזהות איזה מסך בגרף מאפשר להגיע ל-Netflix.

בקשת המשתמש:

"${message}"

==================================================
שלב 3 - זיהוי מסך היעד
==================================================

מצא בתוך גרף הניווט את המסך או הפעולה שהכי מתאימים לבקשת המשתמש.

אין לבחור יעד שאינו קיים בגרף.

אם קיימים כמה יעדים אפשריים, בחר את היעד שהכי מתאים לבקשה ולמצב הנוכחי של המשתמש.

==================================================
שלב 4 - מציאת מסלול
==================================================

מצא מסלול מלא מהמסך הנוכחי למסך היעד.

השתמש אך ורק במעברים שקיימים בגרף.

אסור:
- לדלג על שלבים.
- להמציא כפתורים.
- להמציא מסכים.
- להמציא פעולות.
- להניח שהמשתמש כבר עבר למסך אחר.
- לתת פעולה שאינה קיימת בגרף.

==================================================
שלב 5 - יצירת הוראות מפורטות
==================================================

לכל שלב במסלול תן הוראה מפורטת למשתמש.

כל שלב חייב להסביר:

1. מה המשתמש צריך ללחוץ.
2. איפה בערך נמצאת האפשרות, אם המידע זמין.
3. מה אמור לקרות לאחר הלחיצה.
4. לאיזה מסך המשתמש אמור להגיע.
5. מה עליו לחפש או לזהות במסך הבא.

לדוגמה, במקום לכתוב:

"לחץ על אפליקציות."

כתוב:

"לחץ על האפשרות 'אפליקציות' בתפריט הראשי. לאחר הלחיצה אמור להיפתח מסך האפליקציות. במסך החדש חפש את Netflix."

אם הפעולה היא דרך שלט, אפשר לכתוב למשל:

"לחץ בשלט על חץ ימינה עד שהאפשרות 'אפליקציות' מסומנת, ולאחר מכן לחץ OK."

אבל כתוב הוראה כזאת רק אם פעולות אלו קיימות בגרף.

==================================================
שלב 6 - התייחסות למסך הנוכחי
==================================================

ההוראה הראשונה חייבת להתאים למה שרואים עכשיו בתמונה.

אל תתחיל את ההסבר מנקודה אחרת במערכת.

אם לדוגמה המשתמש כבר נמצא במסך Apps,
אל תגיד לו קודם לפתוח Apps.

התחל מהמצב שבו הוא נמצא בפועל.

==================================================
שלב 7 - דיוק
==================================================

השתמש בשמות המדויקים של הכפתורים והמסכים כפי שהם מופיעים בגרף.

אם בגרף כתוב:

OPEN_APPS

אל תחליף אותו בפעולה אחרת.

אם במסך מופיעה אפשרות בשם:
"כל האפליקציות"

השתמש בשם הזה בהסבר למשתמש.

==================================================
שלב 8 - במקרה שאין מסלול
==================================================

אם לא ניתן למצוא מסלול אמיתי בגרף:

אל תמציא פתרון.

החזר:

"מצאתי את המסך הנוכחי ואת בקשת המשתמש, אבל אין בגרף הניווט מסלול שמאפשר להגיע ליעד המבוקש."

==================================================
סגנון התשובה
==================================================

- כתוב בעברית.
- השתמש במשפטים פשוטים.
- היה מפורט אבל לא ארוך שלא לצורך.
- כתוב כאילו אתה מדריך אדם מבוגר שלא מכיר היטב את המערכת.
- הסבר פעולה אחת בכל שלב.
- אל תגיד רק "עבור", "פתח", "בחר" בלי להסביר איך.
- אל תוסיף מידע שאינו קיים בתמונה או בגרף.
- אל תציג ידע כללי על מערכת הטלוויזיה.
- המידע היחיד שמותר לך להשתמש בו הוא התמונה, בקשת המשתמש והגרף.

==================================================
גרף הניווט
==================================================

${JSON.stringify(navigationGraph, null, 2)}

==================================================
פורמט תשובה
==================================================

החזר JSON בלבד.

{
  "currentScreen": "מזהה המסך הנוכחי מהגרף",

  "currentScreenReason": "הסבר קצר מה בתמונה גרם לך לזהות שזה המסך",

  "userIntent": "מה המשתמש רוצה לבצע",

  "targetScreen": "מזהה מסך היעד מהגרף",

  "steps": [
    {
      "step": 1,

      "fromScreen": "המסך שממנו מתחילים את השלב",

      "action": "הפעולה המדויקת כפי שהיא מופיעה בגרף",

      "instruction": "הוראה מפורטת וברורה למשתמש",

      "expectedResult": "מה המשתמש אמור לראות לאחר ביצוע הפעולה",

      "toScreen": "המסך שאליו הפעולה מובילה"
    }
  ],

  "finalInstruction": "הסבר מלא וקצר למשתמש של כל המסלול לפי הסדר",

  "success": true
}
`;
  const response = await ai.chat.completions.create({
    model: chatModel,
    max_tokens: navigationMaxTokens,
    messages: [{ role: "user", content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
    ] }],
    response_format: { type: "json_object" },
  });

  return parseModelJson(response.choices[0].message.content);
}

// ==================================================
// 3. TEXT -> VOICE
// ==================================================

async function generateSpeech(text) {
  const response = await ai.audio.speech.create({
    model: speechModel,
    input: text,
    voice: "nova",
    response_format: "pcm",
  });
  return pcmToWav(Buffer.from(await response.arrayBuffer()));
}

// ==================================================
// TEST ENDPOINT: TEXT CHAT
// ==================================================

app.post(
  "/api/gemini",
  async (req, res) => {
    try {
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({
          error:
            "Message is required",
        });
      }

      const response = await ai.chat.completions.create({
        model: chatModel,
        max_tokens: 512,
        messages: [{ role: "user", content: message }],
      });

      res.json({
        reply: response.choices[0].message.content,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Failed to get model response",
      });
    }
  }
);

// ==================================================
// TEST ENDPOINT: VOICE -> TEXT
// ==================================================

app.post(
  "/api/voice",
  upload.single("audio"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error:
            "No audio file received",
        });
      }

      const text =
        await transcribeAudio(
          req.file
        );

      res.json({
        success: true,
        text,
      });
    } catch (error) {
      console.error(error);

      const failure = providerErrorResponse(error, "Failed to transcribe voice");
      res.status(failure.status).json(failure);
    }
  }
);

// ==================================================
// TEST ENDPOINT: IMAGE + TEXT -> NAVIGATION
// ==================================================

app.post(
  "/api/gemini/image",
  async (req, res) => {
    try {
      const {
        imageName,
        message,
      } = req.body;

      if (!imageName) {
        return res.status(400).json({
          error:
            "imageName is required",
        });
      }

      const navigation =
        await getNavigation({
          imageName,
          message:
            message ||
            "עזור לי לנווט במערכת",
        });

      res.json({
        success: true,
        navigation,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Failed to analyze image",
        details: error.message,
      });
    }
  }
);

// ==================================================
// TEST ENDPOINT: TEXT -> VOICE
// ==================================================

app.post(
  "/api/tts",
  async (req, res) => {
    try {
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({
          error:
            "text is required",
        });
      }

      const wavBuffer =
        await generateSpeech(text);

      res.setHeader(
        "Content-Type",
        "audio/wav"
      );

      res.send(wavBuffer);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Failed to generate voice",
        details: error.message,
      });
    }
  }
);

// ==================================================
// 🚀 MAIN MVB ENDPOINT
//
// VOICE/TEXT
//      ↓
// TRANSCRIPTION
//      ↓
// IMAGE + GRAPH
//      ↓
// NAVIGATION
//      ↓
// TTS
// ==================================================

app.post(
  "/api/assistant",
  upload.single("audio"),
  async (req, res) => {
    try {
      console.time(
        "FULL ASSISTANT REQUEST"
      );

      const {
        imageName,
        message,
      } = req.body;

      // ------------------------------------------
      // IMAGE IS REQUIRED
      // ------------------------------------------

      if (!imageName) {
        return res.status(400).json({
          error:
            "imageName is required",
        });
      }

      // ------------------------------------------
      // STEP 1
      // GET USER REQUEST
      // ------------------------------------------

      let userMessage = message;

      // If voice was sent,
      // convert voice -> text
      if (req.file) {
        console.log(
          "1. Transcribing voice..."
        );

        userMessage =
          await transcribeAudio(
            req.file
          );

        console.log(
          "Transcript:",
          userMessage
        );
      }

      if (!userMessage) {
        return res.status(400).json({
          error:
            "Send either message or audio",
        });
      }

      // ------------------------------------------
      // STEP 2
      // IMAGE + MESSAGE + GRAPH
      // ------------------------------------------

      console.log(
        "2. Finding navigation..."
      );

      const navigation =
        await getNavigation({
          imageName,
          message: userMessage,
        });

      console.log(
        "Navigation:",
        navigation
      );

      // ------------------------------------------
      // STEP 3
      // TEXT -> SPEECH
      // ------------------------------------------

      console.log(
        "3. Generating speech..."
      );

      let audioBase64 = null;

      try {
        const audioBuffer =
          await generateSpeech(
            navigation.answer
          );

        audioBase64 =
          audioBuffer.toString(
            "base64"
          );
      } catch (ttsError) {
        // Navigation still works
        // even if TTS fails
        console.error(
          "TTS failed:",
          ttsError
        );
      }

      console.timeEnd(
        "FULL ASSISTANT REQUEST"
      );

      // ------------------------------------------
      // FINAL RESPONSE
      // ------------------------------------------

      res.json({
        success: true,

        transcript:
          userMessage,

        currentScreen:
          navigation.currentScreen,

        targetScreen:
          navigation.targetScreen,

        steps:
          navigation.steps,

        answer:
          navigation.answer,

        audio: audioBase64
          ? {
              mimeType:
                "audio/wav",

              data:
                audioBase64,
            }
          : null,
      });
    } catch (error) {
      console.error(
        "Assistant error:",
        error
      );

      const failure = providerErrorResponse(error, "Assistant request failed");
      res.status(failure.status).json({ success: false, ...failure });
    }
  }
);

// ==================================================
// SERVER
// ==================================================

const PORT =
  process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});
