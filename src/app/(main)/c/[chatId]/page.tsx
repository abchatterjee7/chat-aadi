"use client";
import ChatInput from "@/components/chatinput/chatinput";
import React, { use, useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from "rehype-highlight";
import 'highlight.js/styles/github.css';
import hljs from 'highlight.js';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('mark', markdown); // Alias 'mark' to 'markdown'
import { useChats } from "@/hooks/chat";
import { CopyButton } from "@/components/CopyButton";

type Message = {
  id: number | string;
  role: string;
  content: string;
};

export default function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [messages, setAllMessages] = useState<Message[]>([]);
  const router = useRouter();

  const hasFetched = useRef(false);
  const { startPollingChat } = useChats();
  const [autoScroll, setAutoScroll] = useState(true);
  const pollingCleanupRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) {
      setError('Chat ID is missing');
      return;
    }

    const handlePollingError = (error: Error) => {
      if (error.message === 'Chat not found') {
        setError('This chat could not be found. It may have been deleted.');
        // Redirect to chat list after a delay
        setTimeout(() => router.push('/'), 2000);
      } else {
        setError('Failed to load chat. Please try again.');
      }
    };

    try {
      const cleanup = startPollingChat(chatId, handlePollingError);
      if (typeof cleanup === 'function') {
        pollingCleanupRef.current = cleanup;
      }
      
      // Clear the interval when the component unmounts or chatId changes
      return () => {
        if (pollingCleanupRef.current) {
          pollingCleanupRef.current();
          pollingCleanupRef.current = null;
        }
      };
    } catch (err) {
      console.error('Error starting chat polling:', err);
      setError('Failed to start chat polling. Please try again.');
    }
  }, [chatId, startPollingChat, router]);

  const streamAssistantResponse = useCallback(async (prompt: string) => {
    try {
      const res = await fetch(`/api/chat/${chatId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPrompt: prompt }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";

      const tempId = Date.now();
      setAllMessages(prev => [...prev, { id: tempId, role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        assistantMessage += chunk;
        setAllMessages(prev =>
          prev.map(msg => (msg.id === tempId ? { ...msg, content: assistantMessage } : msg))
        );
     
      }
    } catch (err) {
      console.error("Error streaming assistant:", err);
    }
  }, [chatId]);

  const sendPrompt = useCallback(async (prompt: string) => {
    const tempUser = { id: Date.now(), role: "user", content: prompt };
    setAllMessages(prev => [...prev, tempUser]);
    await streamAssistantResponse(prompt);
  }, [streamAssistantResponse]);

  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/${chatId}/message`);
      if (res.ok) {
        const data = await res.json();
        const lastMessage = data[data.length - 1];
        if (lastMessage?.role === "user") sendPrompt(lastMessage.content);
        else {
          setAllMessages(data);
        }
        if (data.length === 1) {
          // Clean up any existing polling
          if (pollingCleanupRef.current) {
            pollingCleanupRef.current();
          }
          // Start new polling and store cleanup function
          pollingCleanupRef.current = startPollingChat(chatId);
        }
      }
    } catch (err) {
      console.error('Error fetching chat:', err);
    }
  }, [chatId, sendPrompt, startPollingChat]);

  useEffect(() => {
    if (autoScroll && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    if (!chatContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;

    // If user is close to bottom (within 50px), enable auto-scroll
    if (scrollHeight - scrollTop - clientHeight < 50) {
      setAutoScroll(true);
    } else {
      // User scrolled up -> stop auto-scroll
      setAutoScroll(false);
    }
  };

  // Clean up polling on unmount or chatId change
  useEffect(() => {
    return () => {
      if (pollingCleanupRef.current) {
        pollingCleanupRef.current();
        pollingCleanupRef.current = null;
      }
    };
  }, [chatId]);

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      fetchChat();
    }
  }, [fetchChat]);

  if (error) {
    return <div className="p-4 text-red-500">{error}</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex-1 overflow-auto" ref={chatContainerRef} onScroll={handleScroll}>
        <div className="flex-1 flex flex-col gap-2 m-auto w-3xl pb-[10rem]">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`group relative w-3xl py-2 px-3 m-2 rounded-xl ${
                msg.role === "user" 
                  ? "max-w-xl w-auto self-end bg-neutral-100" 
                  : "self-start"
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="absolute right-2 -top-2">
                  <CopyButton content={msg.content} />
                </div>
              )}
              <ReactMarkdown
                rehypePlugins={[rehypeHighlight]}
                className="prose break-words max-w-none"
                components={{
                  // Handle paragraphs
                  p: ({ children, ...props }) => {
                    const childrenArray = React.Children.toArray(children);
                    const hasBlockContent = childrenArray.some(
                      (child) => React.isValidElement(child) && [
                        'pre', 'div', 'blockquote', 'ul', 'ol', 'table',
                        'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
                      ].includes(child.type as string)
                    );
                    
                    if (hasBlockContent) {
                      return <>{children}</>;
                    }
                    
                    // Check if the paragraph is empty or only contains whitespace
                    const isEmpty = childrenArray.every(
                      (child) => typeof child === 'string' && child.trim() === ''
                    );
                    
                    if (isEmpty) {
                      return null; // Skip rendering empty paragraphs
                    }
                    
                    return <p className="my-4" {...props}>{children}</p>;
                  },
                  // Handle code blocks
                  pre: ({ children }) => {
                    return <div className="my-4">{children}</div>;
                  },
                  code({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const language = match ? match[1] : 'plaintext';
                    const codeContent = String(children).replace(/\n$/, '');
                    
                    if (inline) {
                      return (
                        <code className={`${className} bg-gray-100 px-1.5 py-0.5 rounded`} {...props}>
                          {children}
                        </code>
                      );
                    }
                    
                    return (
                      <div className="relative my-4 rounded-md overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-1 text-xs text-gray-400 bg-gray-800">
                          <span>{language}</span>
                          <CopyButton content={codeContent} />
                        </div>
                        <pre className="!m-0 !p-0 !bg-gray-900">
                          <code
                            className={`${className} !p-4 !bg-gray-900 !text-gray-100 block overflow-x-auto`}
                            {...props}
                          >
                            {children}
                          </code>
                        </pre>
                      </div>
                    );
                  },
                }}
                skipHtml
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          ))}
        </div>
      </div>
      <div className="sticky bottom-0 flex gap-2 w-full z-1 flex-col items-center bg-white border-t">
        <div className="w-3xl p-4">
          <ChatInput sendPrompt={sendPrompt} />
        </div>
        <p className="bg-white mb-2 text-xs text-neutral-600">
          ChatAadi can make mistakes. Check important info. See Cookie Preferences.
        </p>
      </div>
    </div>
  );
}
