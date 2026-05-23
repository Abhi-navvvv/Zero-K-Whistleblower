"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount, useSignMessage, Icon } from "@zk-whistleblower/ui";
import {
  generateKeyPair,
  exportKeyToJwk,
  importPublicKeyFromJwk,
  importPrivateKeyFromJwk,
  generateAesKey,
  encryptAesKeyWithRsa,
  decryptAesKeyWithRsa,
  encryptMessage,
  decryptMessage,
} from "../../../utils/crypto";

interface AdminChatPanelProps {
  requestId: string;
  selectedAdmins: string[];
}

interface ChatKeyResponse {
  adminAddress: string;
  publicKeyJwk: string;
}

interface EncryptedChatMessage {
  id: string;
  senderAddress: string;
  senderPseudonym: string;
  ciphertext: string;
  iv: string;
  encryptedKeys: Record<string, string>;
  createdAt: string;
}

interface DecryptedChatMessage {
  id: string;
  senderAddress: string;
  senderPseudonym: string;
  text: string;
  createdAt: string;
  isMe: boolean;
}

function getPseudonym(address: string, requestId: string): string {
  const input = `${address.toLowerCase()}:${requestId.toLowerCase()}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash = hash & hash;
  }
  const index = Math.abs(hash);
  const adjectives = [
    "Silent", "Vigilant", "Cryptic", "Shadow", "Spectral",
    "Stealthy", "Shielded", "Iron", "Quantum", "Cipher",
    "Apex", "Nova", "Cosmic", "Phantom", "Tactical",
  ];
  const nouns = [
    "Guardian", "Watcher", "Falcon", "Sentry", "Phoenix",
    "Oracle", "Specter", "Cipher", "Owl", "Stalker",
    "Vanguard", "Ranger", "Titan", "Shadow", "Enforcer",
  ];
  const adj = adjectives[index % adjectives.length];
  const noun = nouns[Math.floor(index / adjectives.length) % nouns.length];
  return `${adj} ${noun}`;
}

export default function AdminChatPanel({ requestId, selectedAdmins }: AdminChatPanelProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [myKeys, setMyKeys] = useState<{ publicKeyJwk: string; privateKey: CryptoKey } | null>(null);
  const [committeeKeys, setCommitteeKeys] = useState<ChatKeyResponse[]>([]);
  const [messages, setMessages] = useState<DecryptedChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [isCommitteeMember, setIsCommitteeMember] = useState(false);
  
  const decryptedCache = useRef<Record<string, string>>({});
  const messageEndRef = useRef<HTMLDivElement>(null);

  // Check membership
  useEffect(() => {
    if (!address) {
      setIsCommitteeMember(false);
      return;
    }
    const isMember = selectedAdmins.map(a => a.toLowerCase()).includes(address.toLowerCase());
    setIsCommitteeMember(isMember);
  }, [address, selectedAdmins]);

  // Load or generate local E2EE keys
  const loadLocalKeys = useCallback(async (voterAddress: string) => {
    const pubKeyKey = `zk-whistleblower:chat-public-jwk:${voterAddress.toLowerCase()}`;
    const privKeyKey = `zk-whistleblower:chat-private-jwk:${voterAddress.toLowerCase()}`;

    const cachedPub = localStorage.getItem(pubKeyKey);
    const cachedPriv = localStorage.getItem(privKeyKey);

    if (cachedPub && cachedPriv) {
      try {
        const privateKey = await importPrivateKeyFromJwk(cachedPriv);
        setMyKeys({ publicKeyJwk: cachedPub, privateKey });
        return { publicKeyJwk: cachedPub, privateKey };
      } catch (err) {
        console.error("Failed to import cached E2EE keys, generating new ones", err);
      }
    }

    // Generate new keypair
    const keyPair = await generateKeyPair();
    const pubJwk = await exportKeyToJwk(keyPair.publicKey);
    const privJwk = await exportKeyToJwk(keyPair.privateKey);

    localStorage.setItem(pubKeyKey, pubJwk);
    localStorage.setItem(privKeyKey, privJwk);

    setMyKeys({ publicKeyJwk: pubJwk, privateKey: keyPair.privateKey });
    return { publicKeyJwk: pubJwk, privateKey: keyPair.privateKey };
  }, []);

  // Fetch committee keys and check if current admin needs to register theirs
  const syncKeys = useCallback(async (voterAddress: string, localPublicKeyJwk: string) => {
    try {
      const res = await fetch(`/api/consensus/chat/keys?requestId=${requestId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch committee keys");

      const keysList = (data.keys ?? []) as ChatKeyResponse[];
      setCommitteeKeys(keysList);

      const hasMyKey = keysList.some(k => k.adminAddress.toLowerCase() === voterAddress.toLowerCase());
      if (!hasMyKey) {
        // Need to register E2EE public key
        setRegistering(true);
        const signature = await signMessageAsync({
          message: `Registering chat key: ${localPublicKeyJwk}`,
        });

        const regRes = await fetch("/api/consensus/chat/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adminAddress: voterAddress,
            publicKeyJwk: localPublicKeyJwk,
            signature,
          }),
        });
        const regData = await regRes.json();
        if (!regRes.ok || !regData.ok) throw new Error(regData.error ?? "Failed to register E2EE key");

        // Fetch keys again
        const refreshRes = await fetch(`/api/consensus/chat/keys?requestId=${requestId}`);
        const refreshData = await refreshRes.json();
        setCommitteeKeys(refreshData.keys ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setRegistering(false);
    }
  }, [requestId, signMessageAsync]);

  // Load and Decrypt Messages
  const fetchMessages = useCallback(async (voterAddress: string, privateKey: CryptoKey) => {
    try {
      const res = await fetch(`/api/consensus/chat/messages?requestId=${requestId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch messages");

      const rawMessages = (data.messages ?? []) as EncryptedChatMessage[];
      const decryptedList: DecryptedChatMessage[] = [];

      for (const msg of rawMessages) {
        // Check cache first
        if (decryptedCache.current[msg.id]) {
          decryptedList.push({
            id: msg.id,
            senderAddress: msg.senderAddress,
            senderPseudonym: msg.senderPseudonym,
            text: decryptedCache.current[msg.id],
            createdAt: msg.createdAt,
            isMe: msg.senderAddress.toLowerCase() === voterAddress.toLowerCase(),
          });
          continue;
        }

        // Decrypt
        const myEncryptedKey = msg.encryptedKeys[voterAddress.toLowerCase()];
        if (!myEncryptedKey) {
          decryptedList.push({
            id: msg.id,
            senderAddress: msg.senderAddress,
            senderPseudonym: msg.senderPseudonym,
            text: "🔒 Message encrypted for other committee members",
            createdAt: msg.createdAt,
            isMe: false,
          });
          continue;
        }

        try {
          const aesKey = await decryptAesKeyWithRsa(myEncryptedKey, privateKey);
          const decryptedText = await decryptMessage(msg.ciphertext, msg.iv, aesKey);
          
          decryptedCache.current[msg.id] = decryptedText;

          decryptedList.push({
            id: msg.id,
            senderAddress: msg.senderAddress,
            senderPseudonym: msg.senderPseudonym,
            text: decryptedText,
            createdAt: msg.createdAt,
            isMe: msg.senderAddress.toLowerCase() === voterAddress.toLowerCase(),
          });
        } catch (decErr) {
          console.error("Failed to decrypt message", msg.id, decErr);
          decryptedList.push({
            id: msg.id,
            senderAddress: msg.senderAddress,
            senderPseudonym: msg.senderPseudonym,
            text: "❌ Decryption failed (Key mismatch)",
            createdAt: msg.createdAt,
            isMe: false,
          });
        }
      }

      setMessages(decryptedList);
    } catch (err: any) {
      console.error(err);
    }
  }, [requestId]);

  // Initial Sync
  useEffect(() => {
    if (!address || !isCommitteeMember) {
      setLoading(false);
      return;
    }

    let active = true;
    let pollInterval: NodeJS.Timeout;

    const init = async () => {
      setLoading(true);
      setError("");
      try {
        const localKeys = await loadLocalKeys(address);
        if (!active) return;
        await syncKeys(address, localKeys.publicKeyJwk);
        if (!active) return;
        await fetchMessages(address, localKeys.privateKey);

        // Start polling for new messages
        pollInterval = setInterval(() => {
          if (active) {
            void fetchMessages(address, localKeys.privateKey);
          }
        }, 4000);
      } catch (err: any) {
        if (active) setError(err?.message ?? String(err));
      } finally {
        if (active) setLoading(false);
      }
    };

    void init();

    return () => {
      active = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [address, isCommitteeMember, loadLocalKeys, syncKeys, fetchMessages]);

  // Auto scroll to bottom
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send Message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !address || !myKeys) return;

    const messageText = text.trim();
    setText("");
    setError("");

    try {
      // 1. Generate one-time AES key
      const aesKey = await generateAesKey();

      // 2. Encrypt the message text
      const { ciphertext, iv } = await encryptMessage(messageText, aesKey);

      // 3. Encrypt the AES key for every admin in the committee who has registered their public key
      const encryptedKeysMap: Record<string, string> = {};
      const missingKeysAdmins: string[] = [];

      for (const admin of selectedAdmins) {
        const adminNorm = admin.toLowerCase();
        const committeeKeyRecord = committeeKeys.find(
          (k) => k.adminAddress.toLowerCase() === adminNorm
        );

        if (committeeKeyRecord) {
          try {
            const pubKey = await importPublicKeyFromJwk(committeeKeyRecord.publicKeyJwk);
            const encKey = await encryptAesKeyWithRsa(aesKey, pubKey);
            encryptedKeysMap[adminNorm] = encKey;
          } catch (keyErr) {
            console.error(`Failed to encrypt AES key for ${adminNorm}`, keyErr);
          }
        } else {
          missingKeysAdmins.push(adminNorm);
        }
      }

      if (Object.keys(encryptedKeysMap).length === 0) {
        throw new Error("No E2EE public keys available in the committee to encrypt this message.");
      }

      const myPseudonym = getPseudonym(address, requestId);

      const res = await fetch("/api/consensus/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consensusRequestId: requestId,
          senderAddress: address,
          senderPseudonym: myPseudonym,
          ciphertext,
          iv,
          encryptedKeys: encryptedKeysMap,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to send message");

      // Instantly load new messages
      void fetchMessages(address, myKeys.privateKey);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  if (!isCommitteeMember) {
    return (
      <section className="card bg-white/5 border border-white/10 p-5 space-y-3">
        <div className="flex items-center gap-3">
          <Icon name="lock" className="text-yellow-500 text-lg" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Secure Admin Chat</h3>
        </div>
        <p className="text-xs text-slate-500 font-mono">
          Only admins assigned to the selected committee can access this encrypted chat room.
        </p>
      </section>
    );
  }

  return (
    <section className="card border border-purple-500/20 bg-black/40 flex flex-col h-[500px]">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-white/10 pb-3 mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
          </span>
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
              Secure Committee Chat Room
              <span title="End-to-End Encrypted" className="flex items-center">
                <Icon name="verified_user" className="text-purple-400 text-sm" />
              </span>
            </h3>
            <p className="text-[10px] font-mono text-slate-500 mt-0.5">
              {committeeKeys.length} / {selectedAdmins.length} keys synchronized
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono bg-purple-500/10 text-purple-400 px-2 py-0.5 border border-purple-500/20 uppercase tracking-widest">
            E2EE Active
          </span>
        </div>
      </div>

      {/* Message Area */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-3 pr-2 scrollbar-thin">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
            <Icon name="autorenew" className="animate-spin text-xl text-purple-400" />
            <p className="text-[10px] font-mono uppercase tracking-widest">Initializing E2EE Chat…</p>
          </div>
        ) : registering ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <Icon name="key" className="text-2xl text-purple-400 animate-bounce" />
            <p className="text-xs font-bold text-white uppercase tracking-widest">Sign with Wallet</p>
            <p className="text-[10px] font-mono text-slate-500 max-w-xs leading-relaxed">
              Please sign the message in your wallet to register your secure chat key. This verifies your identity to other committee members.
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500 font-mono text-center">
            <Icon name="chat_bubble_outline" className="text-xl text-slate-600" />
            <p className="text-[10px] uppercase tracking-widest">No messages yet</p>
            <p className="text-[9px] text-slate-700 max-w-xs leading-relaxed">
              Start the discussion! Messages are encrypted locally in your browser before being saved.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col max-w-[85%] ${
                msg.isMe ? "ml-auto items-end" : "mr-auto items-start"
              }`}
            >
              <span className="text-[9px] font-mono text-slate-500 mb-1 px-1 flex items-center gap-1">
                {msg.senderPseudonym} 
                <span className="text-slate-600">• {new Date(msg.createdAt).toLocaleTimeString()}</span>
              </span>
              <div
                className={`p-3 text-xs font-mono border break-all ${
                  msg.isMe
                    ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                    : "bg-white/5 border-white/10 text-slate-300"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))
        )}
        <div ref={messageEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSend} className="mt-auto pt-3 border-t border-white/10 shrink-0">
        {error && (
          <p className="text-[10px] font-mono text-red-400 mb-3 bg-red-900/15 border border-red-500/20 p-2">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <input
            className="flex-1 input font-mono text-xs h-10 px-3"
            placeholder="Type encrypted message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading || registering}
          />
          <button
            type="submit"
            className="btn-primary h-10 px-5 shrink-0 flex items-center gap-1.5"
            disabled={loading || registering || !text.trim()}
          >
            <Icon name="send" className="text-sm" />
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
