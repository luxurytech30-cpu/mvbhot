import { ai, speechModels, speechVoiceStyles } from '../ai/ai-models.js';
import { timedAction } from '../action-timer.js';

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

export async function generateSpeech(text, runAction = timedAction) {
  const errors = [];

  for (const [index, model] of speechModels.entries()) {
    try {
      const output = await runAction(`Try TTS model ${model}`, async () => {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: speechVoiceStyles[index] === "direct"
                ? { voice: "Kore" }
                : { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        });
        const audio = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData;
        if (!audio?.data) throw new Error("Gemini returned no speech audio");

        const bytes = Buffer.from(audio.data, "base64");
        if (bytes.length === 0) throw new Error("Gemini returned empty speech audio");
        const isWav = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF"
          && bytes.toString("ascii", 8, 12) === "WAVE";
        if (!isWav && audio.mimeType?.toLowerCase().includes("wav")) {
          throw new Error("Gemini returned audio/wav without a WAV header");
        }
        return isWav ? bytes : pcmToWav(bytes);
      });
      return output;
    } catch (error) {
      errors.push(error);
    }
  }

  throw new AggregateError(errors, "All Gemini speech models failed");
}
