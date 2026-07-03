"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";

interface WaStatus {
  status: string;
  phone_number: string | null;
  last_connected_at: string | null;
  error_message: string | null;
  qr_raw: string | null;
  qr_data_uri: string | null;
  credentials_on_disk: boolean;
}

export default function ConnectWaPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [waStatus, setWaStatus] = useState<WaStatus | null>(null);
  const [trying, setTrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ── Fetch current status ──
  const fetchStatus = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const data = await api.get<WaStatus>("/api/wa/session/status");
      if (!mountedRef.current) return;
      setWaStatus(data);

      // Connected → redirect to dashboard
      if (data.status === "connected") {
        if (pollRef.current) clearInterval(pollRef.current);
        setTimeout(() => {
          if (mountedRef.current) router.replace("/dashboard");
        }, 1500);
        return "connected";
      }
    } catch {
      if (mountedRef.current) setError("Failed to check session status");
    }
  }, [router]);

  // ── Start WA session ──
  const startSession = useCallback(async () => {
    setTrying(true);
    setError(null);
    try {
      await api.post("/api/wa/session/start");
      // Status will be picked up by polling
    } catch (err: any) {
      if (mountedRef.current)
        setError(err?.body?.error || err.message || "Failed to start session");
    } finally {
      if (mountedRef.current) setTrying(false);
    }
  }, []);

  // ── Init: check existing session, start if needed ──
  useEffect(() => {
    mountedRef.current = true;

    async function init() {
      const data = await api.get<WaStatus>("/api/wa/session/status");
      if (!mountedRef.current) return;

      if (data.status === "connected") {
        router.replace("/dashboard");
        return;
      }

      // Start session (will create new or resume pending)
      await startSession();
    }
    init();

    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Polling loop ──
  useEffect(() => {
    // Start polling after a short delay to let the session start
    const startPoll = setTimeout(() => {
      pollRef.current = setInterval(async () => {
        const result = await fetchStatus();
        if (result === "connected" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 3000);
    }, 2000);

    return () => {
      clearTimeout(startPoll);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchStatus]);

  // ── Connected state ──
  if (waStatus?.status === "connected") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            WhatsApp Connected!
          </h1>
          <p className="text-sm text-gray-500">
            {waStatus.phone_number
              ? `Connected as ${waStatus.phone_number}`
              : "Redirecting to dashboard..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-4">
        <div className="text-5xl mb-4">📱</div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Connect WhatsApp
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {waStatus?.status === "pending"
            ? "Scan the QR code below with your WhatsApp app to connect."
            : "Preparing your QR code..."}
        </p>

        {/* QR Code */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 inline-block mb-4">
          {waStatus?.qr_raw ? (
            <div className="flex flex-col items-center gap-3">
              <QRCodeSVG value={waStatus.qr_raw} size={220} level="M" />
              <p className="text-xs text-gray-400">
                QR code refreshes automatically
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center w-[220px] h-[220px] bg-gray-50 rounded-lg">
              {trying ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400">Starting...</span>
                </div>
              ) : (
                <span className="text-sm text-gray-400">No QR yet</span>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mb-4 max-w-sm mx-auto">
            {error}
            <button
              onClick={startSession}
              className="ml-2 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Steps */}
        <div className="text-left max-w-xs mx-auto space-y-2 text-sm text-gray-500">
          <div className="flex items-start gap-2">
            <span className="font-medium shrink-0 w-5">1.</span>
            <span>Open WhatsApp on your phone</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-medium shrink-0 w-5">2.</span>
            <span>Tap Menu or Settings and select Linked Devices</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-medium shrink-0 w-5">3.</span>
            <span>Scan this QR code</span>
          </div>
        </div>
      </div>
    </div>
  );
}
