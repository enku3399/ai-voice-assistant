import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-blue-50 flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold text-blue-900 mb-4 text-center">
        Дуут AI Туслагч
      </h1>
      <p className="text-xl text-blue-700 mb-10 text-center max-w-md">
        Ахмад настнуудад зориулсан хиймэл оюун туслагч
      </p>
      <Link
        href="/voice"
        className="bg-blue-600 hover:bg-blue-700 text-white text-2xl font-semibold px-10 py-5 rounded-2xl shadow-lg transition-colors duration-200"
      >
        Эхлэх
      </Link>
    </main>
  );
}
