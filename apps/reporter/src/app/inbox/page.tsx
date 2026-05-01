"use client";

import { useState, useCallback } from "react";
import { Icon } from "@zk-whistleblower/ui";
import { useOrg } from "@zk-whistleblower/ui";
import { initPoseidon, poseidonHash } from "@zk-whistleblower/shared/src/poseidon";
import { getCurrentEpoch } from "@zk-whistleblower/shared/src/epoch";
import {
  deriveCommKey,
  encryptMessage,
  decryptMessage,
  fetchMessages,
  postMessage,
} from "@zk-whistleblower/shared/src/messaging";
import type { MemberKeyFile } from "@zk-whistleblower/shared/src/secretGen";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DecryptedMsg {
  from: "admin" | "reporter";
  text: string;
  timestamp: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { selectedOrgId } = useOrg();

  // Identity state (from key file)
  const [keyFileName, setKeyFileName] = useState("");
  const [secret, setSecret] = useState("");
  const [commKey, setCommKey] = useState("");
  const [nullifierHash, setNullifierHash] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  // Thread state
  const [messages, setMessages] = useState<DecryptedMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [replyError, setReplyError] = useState("");

  // Determine the admin API base URL (same as relayer)
  const adminBaseUrl = process.env.NEXT_PUBLIC_ADMIN_URL || "";

  // ─── Key file upload ───────────────────────────────────────────────────────

  const handleKeyFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setKeyFileName(file.name);
    setUnlockError("");
    setUnlocking(true);

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Partial<MemberKeyFile>;

      if (typeof parsed.secret === "string" && parsed.secret.trim()) {
        const secretBig = BigInt(parsed.secret.trim());
        setSecret(secretBig.toString());

        // Derive nullifierHash and commKey
        await initPoseidon();
        const epoch = getCurrentEpoch();
        const nullHash = poseidonHash([secretBig, BigInt(epoch)]);
        setNullifierHash(nullHash.toString());

        const key = await deriveCommKey(secretBig);
        setCommKey(key);
        setUnlocked(true);

        // Immediately fetch messages
        await loadMessages(key, nullHash.toString());
      } else if ((parsed as Record<string, unknown>).encrypted) {
        setUnlockError("This key file uses the old encrypted format. Please ask your admin to re-generate your access file.");
      } else {
        throw new Error("Invalid key file");
      }
    } catch (err) {
      if (!unlockError) {
        setUnlockError(err instanceof Error ? err.message : "Failed to read key file");
      }
    } finally {
      setUnlocking(false);
    }
  }, []);

  // ─── Message loading ───────────────────────────────────────────────────────

  const loadMessages = async (key: string, nullHash: string) => {
    setLoading(true);
    try {
      const encrypted = await fetchMessages(adminBaseUrl, nullHash);
      const decrypted: DecryptedMsg[] = [];
      for (const msg of encrypted) {
        try {
          const text = await decryptMessage(key, msg);
          decrypted.push({ from: msg.from, text, timestamp: msg.timestamp });
        } catch {
          decrypted.push({ from: msg.from, text: "[Decryption failed]", timestamp: msg.timestamp });
        }
      }
      setMessages(decrypted);
    } catch {
      // No messages yet is normal
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    if (commKey && nullifierHash) {
      await loadMessages(commKey, nullifierHash);
    }
  }, [commKey, nullifierHash]);

  // ─── Reply handler ─────────────────────────────────────────────────────────

  const handleReply = useCallback(async () => {
    if (!replyText.trim() || !commKey || !nullifierHash) return;
    setReplyStatus("sending");
    setReplyError("");
    try {
      const encrypted = await encryptMessage(commKey, replyText.trim(), "reporter");
      await postMessage(adminBaseUrl, nullifierHash, encrypted);
      setReplyText("");
      setReplyStatus("sent");
      // Refresh
      await loadMessages(commKey, nullifierHash);
      setTimeout(() => setReplyStatus("idle"), 2000);
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : String(e));
      setReplyStatus("error");
    }
  }, [replyText, commKey, nullifierHash, adminBaseUrl]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-white text-4xl font-black leading-none tracking-tighter mb-3 uppercase italic">
          Anonymous Inbox
        </h1>
        <div className="flex items-center gap-4">
          <span className="px-2 py-1 bg-green-500 text-black text-[10px] font-bold uppercase tracking-widest">
            Encrypted Channel
          </span>
          <p className="text-slate-500 text-sm font-mono tracking-tight">
            Check replies from reviewers // Your identity remains hidden
          </p>
        </div>
        <p className="text-slate-500 text-xs font-mono tracking-tight mt-2">
          Active org: {selectedOrgId}
        </p>
      </div>

      {/* Step 1: Identity */}
      <section className="card space-y-4">
        <div>
          <p className="step-label">01_VERIFY_IDENTITY</p>
          <h2 className="section-heading">Upload Your Access File</h2>
          <p className="text-xs font-mono text-slate-500 mt-1">
            Upload the same key file you used to submit your report.
            Your identity is never revealed — only your anonymous mailbox is opened.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="btn-ghost text-xs px-4 py-2 cursor-pointer border-white/20 hover:border-white/40">
            {keyFileName ? "Change File" : "Upload Access File"}
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleKeyFileChange}
            />
          </label>
          <span className="text-[10px] font-mono text-slate-500 truncate max-w-[150px]">{keyFileName}</span>
          {unlocked && <Icon name="check_circle" className="text-green-500 text-xl" />}
          {unlocking && <span className="text-[10px] font-mono text-blue-400 animate-pulse">Deriving keys…</span>}
        </div>

        {unlockError && (
          <p className="text-[10px] text-red-400 font-mono">{unlockError}</p>
        )}
      </section>

      {/* Step 2: Messages */}
      {unlocked && (
        <section className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="step-label">02_MESSAGES</p>
              <h2 className="section-heading">Your Message Thread</h2>
            </div>
            <button
              className="btn-ghost text-xs px-3 py-1"
              onClick={handleRefresh}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "↻ Refresh"}
            </button>
          </div>

          {/* Thread */}
          {loading && messages.length === 0 && (
            <p className="text-[10px] font-mono text-slate-600 animate-pulse">Loading messages…</p>
          )}

          {messages.length > 0 ? (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`p-3 text-xs font-mono rounded ${
                    msg.from === "admin"
                      ? "bg-blue-500/10 border border-blue-500/20 text-blue-300 mr-8"
                      : "bg-green-500/10 border border-green-500/20 text-green-300 ml-8"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-bold uppercase tracking-widest">
                      {msg.from === "admin" ? "Reviewer" : "You"}
                    </span>
                    <span className="text-[9px] text-slate-600">
                      {new Date(msg.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                </div>
              ))}
            </div>
          ) : (
            !loading && (
              <div className="text-center py-8">
                <Icon name="chat" className="text-4xl text-white/10 block mx-auto mb-3" />
                <p className="text-sm text-slate-500">No messages yet</p>
                <p className="text-[10px] font-mono text-slate-600 mt-1">
                  If a reviewer has replied to your report, it will appear here.
                </p>
              </div>
            )
          )}

          {/* Reply box */}
          <div className="border-t border-white/10 pt-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Send a reply
            </p>
            <div className="space-y-2">
              <textarea
                className="w-full border border-white/20 bg-white/5 focus:bg-white/10 focus:border-white focus:outline-none px-3 py-2 font-mono text-xs text-white placeholder-slate-500 transition-colors resize-none rounded"
                rows={3}
                placeholder="Type your anonymous reply…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <div className="flex justify-end">
                <button
                  className="btn-primary text-xs px-6 py-2"
                  onClick={handleReply}
                  disabled={!replyText.trim() || replyStatus === "sending"}
                >
                  {replyStatus === "sending" ? "Sending…" : replyStatus === "sent" ? "Sent ✓" : "Send"}
                </button>
              </div>
            </div>
            {replyError && (
              <p className="text-[10px] font-mono text-red-400">{replyError}</p>
            )}
          </div>
        </section>
      )}

      {/* Info */}
      <p className="text-center text-[10px] font-mono text-slate-500 uppercase tracking-widest">
        All messages are end-to-end encrypted. Only you and authorised reviewers can read them.
      </p>
    </div>
  );
}
