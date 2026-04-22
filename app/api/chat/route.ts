import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

// XML/SSML форматыг эвдэхээс сэргийлж тусгай тэмдэгтүүдийг цэвэрлэх функц
function escapeXml(unsafe: string) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// Frontend-ээс ирэх history-ийн нэг мөрийн төрөл
interface HistoryItem {
  role: 'user' | 'ai';
  text: string;
}

export async function POST(req: Request) {
  try {
    // 1. API түлхүүрүүдийг шалгах
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY тохируулагдаагүй байна.');
    if (!process.env.AZURE_SPEECH_KEY) throw new Error('AZURE_SPEECH_KEY тохируулагдаагүй байна.');
    if (!process.env.AZURE_SPEECH_REGION) throw new Error('AZURE_SPEECH_REGION тохируулагдаагүй байна.');

    const contentType = req.headers.get('content-type') ?? '';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction:
        'Та бол ахмад настнуудад зориулсан энхрий, тусч дуут туслах. Богино, 2-3 өгүүлбэрээр, ойлгомжтой, маш хүндэтгэлтэй хариулна. Ямар ч эможи ашиглахгүй. ХАМГИЙН ЧУХАЛ ДҮРЭМ: Хэрэв хариултанд гадаад үг (Хятад, Англи гэх мэт) оруулах шаардлага гарвал ямар ч латин үсэг, ханз огт ашиглаж болохгүй! Заавал Монгол кирилл үсгээр галиглаж (дуудлагаар нь) бичнэ үү. Жишээ нь \'Nǐmen de shāngpǐn\' гэхийг \'Ни мэн дэ шан пин\' гэж бичнэ. Учир нь таны текстийг унших систем зөвхөн кирилл үсэг танина. МӨН ХАМГИЙН ЧУХАЛ: Хэрэв хэрэглэгч зураг илгээвэл, зургийг маш анхааралтай шинжилж, доторх бүх уншигдахуйц бичвэрийг (жижиг байсан ч) OCR хийж унш. Тэрхүү бичвэрийг товчлоод, тайлбарлаад, хэрэв гадаад хэл дээр байвал Монгол кирилл рүү орчуулж, хүндэтгэлтэйгээр ярьж өг. Хэрэглэгчийн хүссэн зааврыг зургийн агуулгатай уялдуулж хариул. Гадаад үгийг заавал Монгол галигаар бич.',
    });

    let reply: string;

    // ── A. FormData (аудио бичлэг) ──────────────────────────────────────────
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const audioFile = formData.get('audio') as File | null;
      const historyRaw = formData.get('history') as string | null;

      if (!audioFile) {
        return NextResponse.json({ error: 'Аудио файл олдсонгүй.' }, { status: 400 });
      }

      const history: HistoryItem[] = historyRaw ? JSON.parse(historyRaw) : [];

      // Аудио файлыг ArrayBuffer → Base64 руу хөрвүүлэх
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioBase64 = Buffer.from(arrayBuffer).toString('base64');
      const audioMimeType = audioFile.type || 'audio/webm';

      // 2. Gemini API-д аудиог inlineData-аар дамжуулах
      const formattedHistory = history.map((item) => ({
        role: item.role === 'ai' ? 'model' : 'user',
        parts: [{ text: item.text }],
      }));

      const chat = model.startChat({ history: formattedHistory });

      const result = await chat.sendMessage([
        {
          inlineData: {
            mimeType: audioMimeType,
            data: audioBase64,
          },
        },
        {
          text: 'Дээрх аудио бичлэгийг сонсоод, хэрэглэгчийн хэлсэн зүйлд хариул.',
        },
      ]);

      reply = (await result.response).text();

    // ── B. JSON (текст эсвэл зураг) ─────────────────────────────────────────
    } else {
      const body = await req.json();
      const { text, history = [], image }: { text?: string; history: HistoryItem[]; image?: string } = body;

      if (!text && !image) {
        return NextResponse.json(
          { error: 'Хэлсэн үг болон зураг хоёул хоосон байна.' },
          { status: 400 }
        );
      }

      const formattedHistory = history.map((item) => ({
        role: item.role === 'ai' ? 'model' : 'user',
        parts: [{ text: item.text }],
      }));

      const chat = model.startChat({ history: formattedHistory });

      let formattedMessage: any;
      if (image) {
        formattedMessage = [
          { text: text || 'энэ зургийг уншиж өгөөч' },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: image,
            },
          },
        ];
      } else {
        formattedMessage = text!;
      }

      const result = await chat.sendMessage(formattedMessage);
      reply = (await result.response).text();
    }

    // 3. Azure TTS руу илгээж аудио болгох
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;
    const ttsUrl = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const safeReply = escapeXml(reply);
    const ssml = `<speak version='1.0' xml:lang='mn-MN'><voice name='mn-MN-BataaNeural'>${safeReply}</voice></speak>`;

    const ttsResponse = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      },
      body: ssml,
    });

    if (!ttsResponse.ok) {
      const errText = await ttsResponse.text();
      console.error('Azure TTS Error:', errText);
      throw new Error('Azure Speech API-тай холбогдоход алдаа гарлаа.');
    }

    // 4. Аудио файлыг Base64 руу хөрвүүлэх
    const ttsBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    const audioBase64Out = ttsBuffer.toString('base64');

    // 5. Текст болон Аудиог хамтад нь Frontend рүү буцаах
    return NextResponse.json({ reply, audioBase64: audioBase64Out });

  } catch (error: unknown) {
    console.error('API алдаа:', error);
    return NextResponse.json(
      { error: 'Серверт алдаа гарлаа. Дахин оролдоно уу.' },
      { status: 500 }
    );
  }
}
