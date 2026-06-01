export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="text-muted-foreground border-t px-6 py-4 text-center text-xs">
        Apār LLP · Mumbai
      </footer>
    </div>
  );
}
