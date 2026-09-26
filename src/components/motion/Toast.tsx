"use client";

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

// One toast at a time, bottom centre (above the phone tab bar), gone after 3s.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message });
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center md:bottom-8">
        {toast ? (
          <div
            key={toast.id}
            className="pointer-events-auto absolute left-1/2 w-max max-w-[90vw] animate-toast-in rounded-lg bg-secondary px-4 py-3 text-[15px] font-semibold text-secondary-foreground shadow-lg"
          >
            {toast.message}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
