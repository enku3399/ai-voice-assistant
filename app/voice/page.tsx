'use client';

import { useState, useRef } from 'react';

interface HistoryItem {
  role: 'user' | 'ai';
  text: string;
  imagePreview?: string; // Зургийн preview URL (зөвхөн UI-д харуулах)
}

export default function VoiceAssistant() {
  const [status, setStatus] = useState<string>('Товч дарж ярина уу');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isProcessingImage, setIsProcessingImage] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // Батлагдсан (isFinal) үр дүнгийн нийлбэр текст
  const [currentTranscript, setCurrentTranscript] = useState<string>('');
  // Бодит цагийн (interim) текст — дэлгэцэнд харуулах
  const [liveText, setLiveText] = useState<string>('');
  // historyRef нь setHistory-тэй үргэлж синхрон байна.
  const historyRef = useRef<HistoryItem[]>([]);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTranscriptRef = useRef<string>('');
  const liveTextRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Гараар зогсоосон эсэхийг тэмдэглэх — onend дотор боловсруулалт хийхийн тулд
  const manualStopRef = useRef<boolean>(false);

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
   * Текст болон өмнөх ярилцлагын түүхийг серверт илгээнэ.
   */
  const sendToBackend = async (text: string, historyToSend: HistoryItem[], image?: string) => {
    setIsProcessing(true);
    setStatus('Бодож байна...');

    const cleanHistory = historyToSend.map(({ role, text }) => ({ role, text }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, history: cleanHistory, ...(image ? { image } : {}) }),
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
      // Амжилттай болсон ч, алдаа гарсан ч loading state-үүдийг заавал цэвэрлэнэ
      setIsProcessing(false);
      setIsProcessingImage(false);
      // API дуудлага дууссаны дараа liveText-г цэвэрлэх
      setLiveText('');
      liveTextRef.current = '';
    }
  };

  /**
   * Toggle функц: сонсож байвал зогсоо, үгүй бол эхлүүл.
   */
  const handleMicToggle = async () => {
    if (isListening) {
      manualStopRef.current = true;

      // Silence timer-г цуцлах
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      setIsListening(false);

      // Recognition-г зогсоох
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
      }

      // --- Mobile fallback ---
      // Гар утасны хөтөч дээр recognition.stop() дуудсаны дараа onresult болон onend
      // дуудагдахгүй байж болно. Тиймээс finalTranscript + liveText-г нэгтгэж
      // шууд API дуудлага хийнэ. onend дотор давхар дуудлага хийхгүйн тулд
      // manualStopRef-г false болгоно.
      const combinedTranscript = [currentTranscriptRef.current, liveTextRef.current]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (combinedTranscript) {
        manualStopRef.current = false;
        currentTranscriptRef.current = '';
        liveTextRef.current = '';
        setCurrentTranscript('');
        setLiveText('');

        const historyBeforeCurrentMessage = historyRef.current;
        updateHistory((prev) => [...prev, { role: 'user', text: combinedTranscript }]);
        sendToBackend(combinedTranscript, historyBeforeCurrentMessage);
      }
      // combinedTranscript хоосон бол onend дотор боловсруулалт хийгдэнэ (desktop)

      return;
    }

    // --- Эхлүүлэх хэсэг ---

    // In-app browser болон микрофоны дэмжлэгийг шалгах
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Та гар утасны үндсэн Chrome эсвэл Safari хөтөч дээр нээнэ үү. Messenger дотор микрофон ажиллахгүй.');
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      alert('Та гар утасны үндсэн Chrome эсвэл Safari хөтөч дээр нээнэ үү. Messenger дотор микрофон ажиллахгүй.');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(
        'Таны хөтөч дуу таних системийг дэмжихгүй байна.\n\n' +
        'Та Chrome эсвэл Safari хөтөч дээр нээж ашиглана уу.\n' +
        '(Messenger, Facebook зэрэг апп-ын дотоод хөтөч дэмжихгүй.)'
      );
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'mn-MN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    // Шинэ session эхлэхэд reset хийх
    currentTranscriptRef.current = '';
    liveTextRef.current = '';
    setCurrentTranscript('');
    setLiveText('');
    manualStopRef.current = false;

    recognition.onstart = () => {
      setIsListening(true);
      setStatus('Сонсож байна...');
    };

    recognition.onresult = (event: any) => {
      // isFinal үр дүнгүүдийг нэгтгэж батлагдсан текст үүсгэнэ
      let finalPart = '';
      let interimPart = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalPart += event.results[i][0].transcript;
        } else {
          interimPart += event.results[i][0].transcript;
        }
      }
      finalPart = finalPart.trim();
      interimPart = interimPart.trim();

      // Батлагдсан текстийг ref болон state-д хадгалах
      currentTranscriptRef.current = finalPart;
      setCurrentTranscript(finalPart);

      // Interim (бодит цагийн) текстийг ref болон state-д хадгалах
      liveTextRef.current = interimPart;
      setLiveText(interimPart);

      // Гараар зогсоосон тохиолдолд silence timer шаардлагагүй
      if (manualStopRef.current) return;

      // Өмнөх silence timer-г цуцлах
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      // 2 секунд чимээгүй болбол автоматаар зогсоож илгээнэ
      silenceTimerRef.current = setTimeout(() => {
        if (!manualStopRef.current) {
          // Автомат зогсоолт: transcript-г авч, recognition-г зогсоо
          manualStopRef.current = true;

          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }

          setIsListening(false);

          if (recognitionRef.current) {
            try {
              recognitionRef.current.stop();
            } catch (_) {}
          }
        }
      }, 2000);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return;
      console.error('Сонсох үеийн алдаа:', event.error);
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        alert(
          'Микрофоны зөвшөөрөл олгоогүй байна.\n\n' +
          'Та Chrome эсвэл Safari хөтөч дээр нээж, микрофоны зөвшөөрлийг зөвшөөрнө үү.\n' +
          '(Messenger, Facebook зэрэг апп-ын дотоод хөтөч дэмжихгүй.)'
        );
      }
      setStatus('Алдаа гарлаа. Дахин оролдоно уу.');
      setIsListening(false);
      manualStopRef.current = false;
    };

    recognition.onend = () => {
      // Silence timer-г цуцлах
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      // isListening-г false болгох (аль хэдийн false байж болно)
      setIsListening(false);

      // Гараар эсвэл автоматаар зогсоосон тохиолдолд transcript-г боловсруулна.
      // manualStopRef.current = true байвал бид зогсоолт хийсэн гэсэн үг.
      // Энд transcript-г авч, API дуудлага хийнэ — isProcessing энд тохируулагдана.
      if (manualStopRef.current) {
        manualStopRef.current = false;

        // desktop дээр onend дуудагдах үед final + interim-г нэгтгэнэ
        const combinedOnEnd = [currentTranscriptRef.current, liveTextRef.current]
          .filter(Boolean)
          .join(' ')
          .trim();

        // Ref болон state-г цэвэрлэх
        currentTranscriptRef.current = '';
        liveTextRef.current = '';
        setCurrentTranscript('');
        setLiveText('');

        if (combinedOnEnd) {
          const historyBeforeCurrentMessage = historyRef.current;
          updateHistory((prev) => [...prev, { role: 'user', text: combinedOnEnd }]);
          sendToBackend(combinedOnEnd, historyBeforeCurrentMessage);
        } else {
          setStatus('Товч дарж ярина уу');
        }
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err: any) {
      console.error('Recognition эхлүүлэхэд алдаа:', err);
      setStatus('Алдаа гарлаа. Дахин оролдоно уу.');
      setIsListening(false);
    }
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

    setIsProcessingImage(true);
    setStatus('Зураг уншиж байна...');

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.split(',')[1];

      const historyBeforeCurrentMessage = historyRef.current;
      updateHistory((prev) => [
        ...prev,
        { role: 'user', text: '[Зураг илгээв]', imagePreview: dataUrl },
      ]);

      sendToBackend('энэ зургийг уншиж өгөөч', historyBeforeCurrentMessage, base64Data);
    };

    reader.onerror = () => {
      console.error('Зураг уншихад алдаа гарлаа.');
      setStatus('Зураг уншихад алдаа гарлаа.');
      setIsProcessingImage(false);
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
              : status === 'Зураг уншиж байна...' || status === 'Бодож байна...'
              ? 'text-yellow-600 animate-pulse'
              : 'text-gray-600'
          }`}
        >
          {status}
        </div>

        {/* Бодит цагийн транскрипт — сонсож байх үед харуулна */}
        {isListening && (currentTranscript || liveText) && (
          <div className="w-full mb-4 px-4 py-3 rounded-2xl bg-white border border-red-200 shadow-sm text-left min-h-[3rem]">
            {currentTranscript && (
              <span className="text-gray-800 text-base">{currentTranscript} </span>
            )}
            {liveText && (
              <span className="text-gray-400 italic text-base">{liveText}</span>
            )}
          </div>
        )}

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
              disabled={isBusy}
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
                /* Зогсоох дүрс (дөрвөлжин) */
                <>
                  <svg className="w-10 h-10 mb-1" fill="currentColor" viewBox="0 0 20 20">
                    <rect x="4" y="4" width="12" height="12" rx="2" />
                  </svg>
                  <span className="font-medium text-sm">Зогсоох</span>
                </>
              ) : (
                /* Микрофоны дүрс */
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
