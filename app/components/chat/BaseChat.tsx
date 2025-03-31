import type { Message } from 'ai';
import React, { type RefCallback, useCallback } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { IconButton } from '~/components/ui/IconButton';
import { Workbench } from '~/components/workbench/Workbench.client';
import { classNames } from '~/utils/classNames';
import { Messages } from './Messages.client';
import { SendButton } from './SendButton.client';
import { toast } from 'react-toastify';

import styles from './BaseChat.module.scss';

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  messages?: Message[];
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
}

const EXAMPLE_PROMPTS = [
  { text: 'Build a todo app in React using Tailwind' },
  { text: 'Build a simple blog using Astro' },
  { text: 'Create a cookie consent form using Material UI' },
  { text: 'Make a space invaders game' },
  { text: 'How do I center a div?' },
];

const TEXTAREA_MIN_HEIGHT = 76;

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      messageRef,
      scrollRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      enhancingPrompt = false,
      promptEnhanced = false,
      messages,
      input = '',
      sendMessage,
      handleInputChange,
      enhancePrompt,
      handleStop,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    const handleImportProject = useCallback(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');

      input.onchange = (e) => {
        const inputFiles = (e.target as HTMLInputElement).files;
        if (!inputFiles || inputFiles.length === 0) return;

        // Filter out unwanted files and directories
        const filesToImport = Array.from(inputFiles).filter(file => {
          const relativePath = file.webkitRelativePath;
          
          // Common directories/files to exclude
          const excludePaths = [
            'node_modules/',
            '.git/',
            '.github/',
            '.next/',
            '.nuxt/',
            '.vscode/',
            'dist/',
            'build/',
            '.cache/',
            'coverage/',
            'out/',
            'public/assets/',
            'vendor/',
          ];
          
          // File extensions to exclude
          const excludeExtensions = [
            '.DS_Store',
            '.env',
            '.env.local',
            '.env.development',
            '.env.production',
            '.log',
            '.tmp',
            '.temp',
            '.map',
            '.lock',
            '.wasm',
            '.jar',
            '.zip',
            '.tar',
            '.gz',
            '.rar',
            '.7z',
            '.mp4',
            '.mp3',
            '.mov',
            '.avi',
            '.mkv',
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.ico',
            '.svg',
            '.pdf',
            '.ttf',
            '.otf',
            '.woff',
            '.woff2',
          ];
          
          // Check if the path contains any excluded directory
          const containsExcludedDir = excludePaths.some(path => relativePath.includes(path));
          
          // Check if the file has an excluded extension
          const hasExcludedExtension = excludeExtensions.some(ext => relativePath.endsWith(ext));
          
          // Check the file size (skip files larger than 1MB)
          const isFileTooLarge = file.size > 1024 * 1024;
          
          return !containsExcludedDir && !hasExcludedExtension && !isFileTooLarge;
        });

        // Check if there are too many files
        if (filesToImport.length === 0) {
          toast.error('No importable files found. Common directories like node_modules, .git, and binary/media files are excluded.');
          return;
        }

        const MAX_FILES = 100;
        if (filesToImport.length > MAX_FILES) {
          const confirmImport = window.confirm(
            `You're attempting to import ${filesToImport.length} files. This could cause performance issues. Continue with import?`
          );
          
          if (!confirmImport) {
            toast.info('Import canceled');
            return;
          }
        }

        // For chat initialization, use a very specific technical command that's unlikely to trigger generation
        if (!chatStarted) {
          try {
            const syntheticEvent = {
              currentTarget: document.createElement('button'),
              preventDefault: () => {},
              stopPropagation: () => {},
              nativeEvent: new MouseEvent('click'),
              target: document.createElement('button'),
              bubbles: true,
              cancelable: true,
              defaultPrevented: false,
              isDefaultPrevented: () => false,
              isPropagationStopped: () => false,
              isTrusted: true,
              persist: () => {},
              type: 'click',
            } as unknown as React.UIEvent;
            
            // Use a specific prompt that makes the AI help with the imported project
            sendMessage?.(syntheticEvent, "Analyze the package.json file and tell me how to install and run this project");
            
            // Skip waiting for a response, immediately dispatch the import event
            dispatchImportEvent(filesToImport, inputFiles.length);
            
            // Set project import flags 
            (window as any).__PROJECT_IMPORT_MODE__ = true;
            sessionStorage.setItem('currentMode', 'project-import');
            localStorage.setItem('skipAIResponses', 'true');
          } catch (err) {
            console.error("Error in silent import:", err);
            
            // Even if there's an error in chat initialization, still try to import
            dispatchImportEvent(filesToImport, inputFiles.length);
          }
        } else {
          dispatchImportEvent(filesToImport, inputFiles.length);
        }
      };

      // Helper function to dispatch the import event
      const dispatchImportEvent = (filesToImport: File[], totalCount: number) => {
        // Create a custom event with the filtered file data
        const importEvent = new CustomEvent('workbench:import-files', {
          detail: filesToImport,
        });

        // Dispatch the event for the workbench store or other components to handle
        window.dispatchEvent(importEvent);

        // Don't wait for chat start to show success message
        toast.success(`Project imported with ${filesToImport.length} files`);
        
        // Try to force the workbench to appear
        setTimeout(() => {
          try {
            // Use type casting to avoid TypeScript errors
            const ws = (window as any).workbenchStore;
            if (ws && typeof ws.showWorkbench?.set === 'function') {
              ws.showWorkbench.set(true);
            }
          } catch (e) {
            console.error("Error accessing workbench store:", e);
          }
        }, 500);
      };

      input.click();
    }, [chatStarted, sendMessage]);

    return (
      <div
        ref={ref}
        className={classNames(
          styles.BaseChat,
          'relative flex h-full w-full overflow-hidden bg-bolt-elements-background-depth-1',
        )}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>
        <div ref={scrollRef} className="flex overflow-y-auto w-full h-full">
          <div className={classNames(styles.Chat, 'flex flex-col flex-grow min-w-[var(--chat-min-width)] h-full')}>
            {!chatStarted && (
              <div id="intro" className="mt-[26vh] max-w-chat mx-auto">
                <h1 className="text-5xl text-center font-bold text-bolt-elements-textPrimary mb-2">
                  Where ideas begin
                </h1>
                <p className="mb-4 text-center text-bolt-elements-textSecondary">
                  Bring ideas to life in seconds or get help on existing projects.
                </p>
              </div>
            )}
            <div
              className={classNames('pt-6 px-6', {
                'h-full flex flex-col': chatStarted,
              })}
            >
              <ClientOnly>
                {() => {
                  return chatStarted ? (
                    <Messages
                      ref={messageRef}
                      className="flex flex-col w-full flex-1 max-w-chat px-4 pb-6 mx-auto z-1"
                      messages={messages}
                      isStreaming={isStreaming}
                    />
                  ) : null;
                }}
              </ClientOnly>
              <div
                className={classNames('relative w-full max-w-chat mx-auto z-prompt', {
                  'sticky bottom-0': chatStarted,
                })}
              >
                <div
                  className={classNames(
                    'shadow-sm border border-bolt-elements-borderColor bg-bolt-elements-prompt-background backdrop-filter backdrop-blur-[8px] rounded-lg overflow-hidden',
                  )}
                >
                  <textarea
                    ref={textareaRef}
                    className={`w-full pl-4 pt-4 pr-16 focus:outline-none resize-none text-md text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary bg-transparent`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        if (event.shiftKey) {
                          return;
                        }

                        event.preventDefault();

                        sendMessage?.(event);
                      }
                    }}
                    value={input}
                    onChange={(event) => {
                      handleInputChange?.(event);
                    }}
                    style={{
                      minHeight: TEXTAREA_MIN_HEIGHT,
                      maxHeight: TEXTAREA_MAX_HEIGHT,
                    }}
                    placeholder="How can Bolt help you today?"
                    translate="no"
                  />
                  <ClientOnly>
                    {() => (
                      <SendButton
                        show={input.length > 0 || isStreaming}
                        isStreaming={isStreaming}
                        onClick={(event) => {
                          if (isStreaming) {
                            handleStop?.();
                            return;
                          }

                          sendMessage?.(event);
                        }}
                      />
                    )}
                  </ClientOnly>
                  <div className="flex justify-between text-sm p-4 pt-2">
                    <div className="flex gap-1 items-center">
                      <IconButton
                        title="Enhance prompt"
                        disabled={input.length === 0 || enhancingPrompt}
                        className={classNames({
                          'opacity-100!': enhancingPrompt,
                          'text-bolt-elements-item-contentAccent! pr-1.5 enabled:hover:bg-bolt-elements-item-backgroundAccent!':
                            promptEnhanced,
                        })}
                        onClick={() => enhancePrompt?.()}
                      >
                        {enhancingPrompt ? (
                          <>
                            <div className="i-svg-spinners:90-ring-with-bg text-bolt-elements-loader-progress text-xl"></div>
                            <div className="ml-1.5">Enhancing prompt...</div>
                          </>
                        ) : (
                          <>
                            <div className="i-bolt:stars text-xl"></div>
                            {promptEnhanced && <div className="ml-1.5">Prompt enhanced</div>}
                          </>
                        )}
                      </IconButton>
                    </div>
                    {input.length > 3 ? (
                      <div className="text-xs text-bolt-elements-textTertiary">
                        Use <kbd className="kdb">Shift</kbd> + <kbd className="kdb">Return</kbd> for a new line
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="bg-bolt-elements-background-depth-1 pb-6">{/* Ghost Element */}</div>
              </div>
            </div>
            {!chatStarted && (
              <div id="examples" className="relative w-full max-w-xl mx-auto mt-8 flex justify-center">
                <div className="flex flex-col space-y-2 [mask-image:linear-gradient(to_bottom,black_0%,transparent_180%)] hover:[mask-image:none]">
                  {EXAMPLE_PROMPTS.map((examplePrompt, index) => {
                    return (
                      <button
                        key={index}
                        onClick={(event) => {
                          sendMessage?.(event, examplePrompt.text);
                        }}
                        className="group flex items-center w-full gap-2 justify-center bg-transparent text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-theme"
                      >
                        {examplePrompt.text}
                        <div className="i-ph:arrow-bend-down-left" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <ClientOnly>{() => <Workbench chatStarted={chatStarted} isStreaming={isStreaming} />}</ClientOnly>
        </div>
        {/* Import Project Button */}
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
          <div
            onClick={handleImportProject}
            className="flex items-center gap-2 bg-bolt-accent text-white px-5 py-3 rounded-lg shadow-lg hover:bg-bolt-accent-dark transition-colors cursor-pointer font-medium"
          >
            <div className="i-ph:folder-open text-xl" />
            Import Local Project
          </div>
        </div>
      </div>
    );
  },
);
