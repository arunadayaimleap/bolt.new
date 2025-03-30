import { useState } from 'react';
import { runChatAnimation } from './Chat.client';
import { chatStore } from '~/lib/stores/chat';
import { toast } from 'react-toastify';
import { webcontainer } from '~/lib/webcontainer';
import { importLocalDirectory } from '~/lib/localImport';

// Define EXAMPLE_PROMPTS 
const EXAMPLE_PROMPTS = [
  { text: 'Build a todo app in React using Tailwind' },
  { text: 'Build a simple blog using Astro' },
  { text: 'Create a cookie consent form using Material UI' },
  { text: 'Make a space invaders game' },
  { text: 'How do I center a div?' },
];

export function BaseChat() {
  const [chatStarted, setChatStarted] = useState(false);

  const openLocalDirectory = async () => {
    if (!window.showDirectoryPicker) {
      toast.error('Your browser does not support the File System Access API');
      return;
    }

    try {
      const container = await webcontainer;
      await importLocalDirectory(container);
      
      // After successful import, start the chat
      await runChatAnimation();
      setChatStarted(true);
      chatStore.setKey('started', true);
      
      // Let user know it worked
      toast.success('Project imported successfully!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to import project');
    }
  };

  return (
    <div>
      {!chatStarted && (
        <div id="examples" className="relative w-full max-w-xl mx-auto mt-8 flex justify-center">
          <div className="absolute -top-12 w-full">
            <button
              onClick={openLocalDirectory}
              className="w-full mb-6 py-3 px-4 flex items-center justify-center gap-2 bg-bolt-elements-cta-background text-bolt-elements-textPrimary hover:brightness-95 rounded-lg font-medium transition-all"
            >
              <div className="i-ph:folder-open-duotone text-xl" />
              Open Local Project
            </button>
          </div>
          <div className="flex flex-col space-y-2 [mask-image:linear-gradient(to_bottom,black_0%,transparent_180%)] hover:[mask-image:none]">
            {EXAMPLE_PROMPTS.map((examplePrompt, index) => (
              <button
                key={index}
                className="group flex items-center w-full gap-2 justify-center bg-transparent text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-theme"
              >
                {examplePrompt.text}
                <div className="i-ph:arrow-bend-down-left" />
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Rest of your component */}
    </div>
  );
}
