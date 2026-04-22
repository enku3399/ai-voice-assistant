'use client';

import { useState, useRef } from 'react';

interface HistoryItem {
  role: 'user' | 'ai';
  text: string;
  imagePreview?: string;
}

export default function VoiceAssistant() {
  const [status, setStatus] = useState<string>('Товч дарж ярина уу');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isProcessingImage, setIsProcessingImage] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const historyRef = useRef<HistoryItem[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * History state болон ref-ийг хамтад нь шинэчлэх тусламжийн функц.
   */
  const updateHistory = (updater: (prev: HistoryItem[]) => HistoryItem[]) => {
    setHistory((prev) => {
      const next = updater(prev);
      historyRef.current = next;
      return next;
    });
  };

  const handleDonate = () => {
    alert('Удахгүй: Энд таны QPay QR код эсвэл дансны дугаар харагдах болно. ❤️');
  };

  /**
   * Аудио Blob болон өмнөх ярилцлагын түүхийг серверт илгээнэ.
   */
  const sendAudioToBackend = async (audioBlob: Blob, historyToSend: HistoryItem[]) => {
    setIsProcessing(true);
    setStatus('Бодож байна...');

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append(
        'history',
        JSON.stringify(historyToSend.map(({ role, text }) => ({ role, text })))
      );

      const res = await fetch('/api/chat', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Серверээс алдаа буцаалаа.');
      }

      const data = await res.json();

      if (data.reply) {
        updateHistory((prev) => [...prev, { role: 'ai', text: data.reply }]);
      }

      if (data.audioBase64) {
        setStatus('Хариулж байна...');
        const audioUrl = `data:audio/mp3;base64,${data.audioBase64}`;
        const audio = new Audio(audioUrl);

        audio.play().catch((e) => {
          console.error('Дуу тоглуулахад алдаа гарлаа:', e);
          setStatus('Дуу тоглуулж чадсангүй.');
        });

        audio.onended = () => {
          setStatus('Товч дарж ярина уу');
        };
      } else {
        setStatus('Товч дарж ярина уу');
      }
    } catch (error: any) {
      console.error('Холболтын алдаа:', error);
      setStatus('Серверт алдаа гарлаа. Дахин оролдоно уу.');
      alert('Алдаа гарлаа: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Зураг болон өмнөх ярилцлагын түүхийг серверт илгээнэ.
   */
  const sendImageToBackend = async (base64Image: string, historyToSend: HistoryItem[]) => {
    setIsProcessing(true);
    setIsProcessingImage(true);
    setStatus('Зураг уншиж байна...');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'энэ зургийг уншиж өгөөч',
          history: historyToSend.map(({ role, text }) => ({ role, text })),
          image: base64Image,
        }),
      });

      if (!res.ok) {
        throw new Error('Серверээс алдаа буцаалаа.');
      }

      const data = await res.json();

      if (data.reply) {
        updateHistory((prev) => [...prev, { role: 'ai', text: data.reply }]);
      }

      if (data.audioBase64) {
        setStatus('Хариулж байна...');
        const audioUrl = `data:audio/mp3;base64,${data.audioBase64}`;
        const audio = new Audio(audioUrl);

        audio.play().catch((e) => {
          console.error('Дуу тоглуулахад алдаа гарлаа:', e);
          setStatus('Дуу тоглуулж чадсангүй.');
        });

        audio.onended = () => {
          setStatus('Товч дарж ярина уу');
        };
      } else {
        setStatus('Товч дарж ярина уу');
      }
    } catch (error: any) {
      console.error('Холболтын алдаа:', error);
      setStatus('Серверт алдаа гарлаа. Дахин оролдоно уу.');
      alert('Алдаа гарлаа: ' + error.message);
    } finally {
      setIsProcessing(false);
      setIsProcessingImage(false);
    }
  };

  /**
   * Микрофон toggle: бичлэг эхлүүлэх / зогсоох.
   */
  const handleMicToggle = async () => {
    // --- Зогсоох ---
    if (isListening) {
      setIsListening(false);
      setStatus('Боловсруулж байна...');

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop(); // onstop дотор API дуудлага хийгдэнэ
      }
      return;
    }

    // --- Эхлүүлэх ---
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Та гар утасны үндсэн Chrome эсвэл Safari хөтөч дээр нээнэ үү. Messenger дотор микрофон ажиллахгүй.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      const code = err?.name ?? err?.message ?? 'unknown';
      alert(
        'Микрофоны зөвшөөрөл олгоогүй байна.\n\n' +
        'Та Chrome эсвэл Safari хөтөч дээр нээж, микрофоны зөвшөөрлийг зөвшөөрнө үү.\n\n' +
        '[Алдааны код: ' + code + ']'
      );
      return;
    }

    streamRef.current = stream;
    audioChunksRef.current = [];

    // Хамгийн өргөн дэмжигдсэн MIME type-г сонгох
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
      ? 'audio/ogg;codecs=opus'
      : '';

    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (err: any) {
      alert('MediaRecorder үүсгэхэд алдаа гарлаа: ' + (err?.message ?? err));
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      // Stream-г чөлөөлөх
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];

      if (chunks.length === 0) {
        setStatus('Товч дарж ярина уу');
        return;
      }

      const audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

      const historyBeforeCurrentMessage = historyRef.current;
      // Хэрэглэгчийн мессежийг history-д нэмэх (placeholder)
      updateHistory((prev) => [...prev, { role: 'user', text: '🎤 Дуу бичлэг' }]);

      await sendAudioToBackend(audioBlob, historyBeforeCurrentMessage);
    };

    recorder.onerror = (e: any) => {
      console.error('MediaRecorder алдаа:', e);
      setIsListening(false);
      setStatus('Бичлэгт алдаа гарлаа. Дахин оролдоно уу.');
      stream.getTracks().forEach((t) => t.stop());
    };

    mediaRecorderRef.current = recorder;
    recorder.start(250); // 250ms тутамд chunk авна

    setIsListening(true);
    setStatus('Сонсож байна...');
  };

  /**
   * Камерны товч дарахад файл сонгох / камер нээх функц.
   */
  const handleCaptureImage = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  /**
   * Файл сонгогдсон үед ажиллах функц.
   */
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.split(',')[1];

      const historyBeforeCurrentMessage = historyRef.current;
      updateHistory((prev) => [
        ...prev,
        { role: 'user', text: '[Зураг илгээв]', imagePreview: dataUrl },
      ]);

      sendImageToBackend(base64Data, historyBeforeCurrentMessage);
    };

    reader.onerror = () => {
      console.error('Зураг уншихад алдаа гарлаа.');
      setStatus('Зураг уншихад алдаа гарлаа.');
    };

    reader.readAsDataURL(file);
  };

  const isBusy = isProcessing || isProcessingImage;

  return (
    <div className="min-h-screen bg-[#f0f4f8] text-[#1a202c] flex flex-col items-center py-10 font-sans">
      <div className="w-full max-w-2xl px-4 sm:px-6 mb-6">
        {/* Нэр болон товчнуудын мөр */}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-bold text-[#2b6cb0] mr-auto whitespace-nowrap">
            🎙️ Дуут Туслагч
          </h1>

          {/* Урамшуулах товч */}
          <button
            onClick={handleDonate}
            title="Урамшуулах"
            className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-yellow-400 hover:bg-yellow-500 active:scale-95 text-yellow-900 font-semibold text-sm shadow transition-transform"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
                clipRule="evenodd"
              />
            </svg>
            Урамшуулах
          </button>

          {/* Гарах товч */}
          <a
            href="/"
            className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-gray-200 hover:bg-gray-300 active:scale-95 text-gray-700 font-semibold text-sm shadow transition-transform"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" />
            </svg>
            Гарах
          </a>
        </div>

        <p className="hidden md:block text-gray-500 text-sm mt-1">Ахмад настнуудад зориулсан дуут туслагч</p>
      </div>

      <div className="flex-1 w-full max-w-2xl px-6 overflow-y-auto mb-8 flex flex-col gap-4">
        {history.length === 0 ? (
          <div className="text-center text-gray-400 mt-20">
            Та доорх товчийг дараад яриагаа эхлүүлнэ үү.
          </div>
        ) : (
          history.map((msg, index) => (
            <div
              key={index}
              className={`p-4 rounded-2xl max-w-[80%] text-lg shadow-sm ${
                msg.role === 'user'
                  ? 'bg-[#3182ce] text-white self-end rounded-tr-sm'
                  : 'bg-white text-gray-800 self-start border border-gray-200 rounded-tl-sm'
              }`}
            >
              <span className="text-xs opacity-70 block mb-1">
                {msg.role === 'user' ? 'Та' : 'AI Туслагч'}
              </span>
              {msg.imagePreview && (
                <img
                  src={msg.imagePreview}
                  alt="Илгээсэн зураг"
                  className="rounded-xl mb-2 max-w-full max-h-48 object-contain border border-white/30"
                />
              )}
              {msg.text}
            </div>
          ))
        )}
      </div>

      {/* Далд файл оруулах input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="w-full max-w-2xl px-6 flex flex-col items-center pb-10">
        <div
          className={`text-xl mb-6 font-medium transition-colors ${
            status === 'Сонсож байна...'
              ? 'text-red-500 animate-pulse'
              : status === 'Хариулж байна...'
              ? 'text-green-600'
              : status === 'Зураг уншиж байна...' || status === 'Бодож байна...' || status === 'Боловсруулж байна...'
              ? 'text-yellow-600 animate-pulse'
              : 'text-gray-600'
          }`}
        >
          {status}
        </div>

        {/* Товчнуудын мөр */}
        <div className="flex items-center gap-6">

          {/* Зураг авах товч */}
          <div className="relative">
            {isProcessingImage && (
              <>
                <div className="absolute inset-0 bg-green-400 rounded-full animate-ping opacity-75"></div>
                <div className="absolute -inset-3 bg-green-300 rounded-full animate-pulse opacity-50"></div>
              </>
            )}
            <button
              onClick={handleCaptureImage}
              disabled={isBusy || isListening}
              title="Зураг авах / Файл сонгох"
              className="relative z-10 w-20 h-20 rounded-full flex flex-col items-center justify-center text-white shadow-xl transition-transform transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 bg-[#38a169]"
            >
              <svg className="w-8 h-8 mb-1" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-medium text-xs">Зураг</span>
            </button>
          </div>

          {/* Микрофоны товч — Toggle: Эхлүүлэх / Зогсоох */}
          <div className="relative">
            {isListening && (
              <>
                <div className="absolute inset-0 bg-red-400 rounded-full animate-ping opacity-75"></div>
                <div className="absolute -inset-4 bg-red-300 rounded-full animate-pulse opacity-50"></div>
              </>
            )}

            <button
              onClick={handleMicToggle}
              disabled={isBusy && !isListening}
              title={isListening ? 'Зогсоох' : 'Дарж ярих'}
              className={`relative z-10 w-28 h-28 rounded-full flex flex-col items-center justify-center text-white shadow-xl transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 ${
                isListening ? 'bg-red-500 scale-110' : 'bg-[#3182ce]'
              }`}
            >
              {isListening ? (
                <>
                  <svg className="w-10 h-10 mb-1" fill="currentColor" viewBox="0 0 20 20">
                    <rect x="4" y="4" width="12" height="12" rx="2" />
                  </svg>
                  <span className="font-medium text-sm">Зогсоох</span>
                </>
              ) : (
                <>
                  <svg className="w-10 h-10 mb-1" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="font-medium">Дарж ярих</span>
                </>
              )}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
