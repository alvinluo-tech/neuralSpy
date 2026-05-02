"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type TestResult = {
  ok: boolean;
  isSameMeaning: boolean;
  reason: string;
  error?: string;
};

type WordPair = {
  civilian: string;
  undercover: string;
};

export default function WhiteboardTestPage() {
  const [wordPair, setWordPair] = useState<WordPair | null>(null);
  const [category, setCategory] = useState("日常");
  const [guessInput, setGuessInput] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<
    Array<{ target: string; guess: string; result: TestResult; timestamp: number }>
  >([]);

  const handleGeneratePair = async () => {
    setGenerating(true);
    setResult(null);
    setGuessInput("");
    try {
      const response = await fetch("/api/grok/words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      if (data.pair) {
        setWordPair(data.pair);
      } else {
        throw new Error("未返回可用词条");
      }
    } catch (err) {
      setResult({
        ok: false,
        isSameMeaning: false,
        reason: "",
        error: err instanceof Error ? err.message : "生成词对失败",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleTest = async () => {
    if (!wordPair || !guessInput.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/dev/whiteboard-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetWord: wordPair.civilian,
          guessedWord: guessInput.trim(),
        }),
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setResult(data);
      setHistory((prev) => [
        { target: wordPair.civilian, guess: guessInput.trim(), result: data, timestamp: Date.now() },
        ...prev,
      ]);
    } catch (err) {
      setResult({
        ok: false,
        isSameMeaning: false,
        reason: "",
        error: err instanceof Error ? err.message : "测试失败",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleQuickTest = async (guess: string) => {
    setGuessInput(guess);
    if (!wordPair) return;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/dev/whiteboard-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetWord: wordPair.civilian,
          guessedWord: guess,
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      setHistory((prev) => [
        { target: wordPair.civilian, guess: guess, result: data, timestamp: Date.now() },
        ...prev,
      ]);
    } catch (err) {
      setResult({
        ok: false,
        isSameMeaning: false,
        reason: "",
        error: err instanceof Error ? err.message : "测试失败",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <main className="app-wrap" style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
        <section className="hero-card" style={{ marginBottom: 16 }}>
          <p className="eyebrow">Dev Tool</p>
          <h1 className="hero-title" style={{ fontSize: "1.4rem" }}>白板猜词判定测试</h1>
          <p className="hint">测试白板猜词的字符串比对逻辑，必须完全一致才算猜中。</p>
        </section>

        <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>1. 生成词对</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="类别（如：日常、食物、动物）"
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border, #333)",
                background: "var(--card, #1a1a1a)",
                color: "var(--foreground, #fff)",
              }}
            />
            <Button
              type="button"
              variant="primary"
              onClick={handleGeneratePair}
              disabled={generating}
            >
              {generating ? "生成中..." : "生成词对"}
            </Button>
          </div>

          {wordPair && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "var(--muted, #222)" }}>
              <div style={{ display: "flex", gap: 24 }}>
                <div>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground, #888)" }}>平民词</span>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--primary, #4ade80)" }}>{wordPair.civilian}</div>
                </div>
                <div>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground, #888)" }}>卧底词</span>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--destructive, #f87171)" }}>{wordPair.undercover}</div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>2. 模拟白板猜词</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={guessInput}
              onChange={(e) => setGuessInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTest()}
              placeholder="输入白板猜测的词"
              disabled={!wordPair}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border, #333)",
                background: "var(--card, #1a1a1a)",
                color: "var(--foreground, #fff)",
              }}
            />
            <Button
              type="button"
              variant="primary"
              onClick={handleTest}
              disabled={loading || !wordPair || !guessInput.trim()}
            >
              {loading ? "判定中..." : "测试判定"}
            </Button>
          </div>

          {wordPair && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 12, color: "var(--muted-foreground, #888)", marginBottom: 6 }}>快速测试用例：</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  wordPair.civilian,
                  wordPair.civilian.charAt(0),
                  "asd123",
                  "随便填",
                  "不知道",
                  "一样的",
                  "那个东西",
                  "12345",
                  "!!!@@@",
                  wordPair.civilian + "的",
                ].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleQuickTest(q)}
                    disabled={loading}
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid var(--border, #333)",
                      background: "var(--card, #1a1a1a)",
                      color: "var(--foreground, #ccc)",
                      cursor: "pointer",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {result && (
          <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>3. 判定结果</h2>
            {result.error ? (
              <div style={{ padding: 12, borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#f87171" }}>
                {result.error}
              </div>
            ) : (
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: result.isSameMeaning ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 600, color: result.isSameMeaning ? "#4ade80" : "#f87171" }}>
                  {result.isSameMeaning ? "完全一致 → 猜词成功" : "不一致 → 猜词失败"}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted-foreground, #888)", marginTop: 4 }}>
                  {result.reason}
                </div>
              </div>
            )}
          </section>
        )}

        {history.length > 0 && (
          <section className="panel" style={{ padding: 16 }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>
              历史记录 ({history.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {history.map((item) => (
                <div
                  key={item.timestamp}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "var(--muted, #222)",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "var(--primary, #4ade80)", fontWeight: 600 }}>{item.target}</span>
                  <span style={{ color: "var(--muted-foreground, #666)" }}>←</span>
                  <span style={{ color: "var(--foreground, #ccc)" }}>{item.guess}</span>
                  <span style={{ color: "var(--muted-foreground, #666)" }}>|</span>
                  <span style={{ color: item.result.isSameMeaning ? "#4ade80" : "#f87171" }}>
                    {item.result.isSameMeaning ? "通过" : "拒绝"}
                  </span>
                  <span style={{ color: "var(--muted-foreground, #666)", fontSize: 11, flex: 1, textAlign: "right" }}>
                    {item.result.reason}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
