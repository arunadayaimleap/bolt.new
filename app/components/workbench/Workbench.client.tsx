import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
}

const viewTransition = { ease: cubicEasingFn };

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: {
    value: 'code',
    text: 'Code',
  },
  right: {
    value: 'preview',
    text: 'Preview',
  },
};

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

export const Workbench = memo(({ chatStarted, isStreaming }: WorkspaceProps) => {
  renderLogger.trace('Workbench');

  const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);
  const selectedView = useStore(workbenchStore.currentView);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  const isProjectImport = useStore(
    computed([workbenchStore.previews], 
      function isImportMode() {
        return Boolean(
          (window as any).__PROJECT_IMPORT_MODE__ === true || 
          sessionStorage.getItem('currentMode') === 'project-import'
        );
      }
    )
  );

  const effectiveChatStarted = Boolean(chatStarted || isProjectImport);

  useEffect(() => {
    if (hasPreview) {
      setSelectedView('preview');
    }
  }, [hasPreview]);

  useEffect(() => {
    workbenchStore.setDocuments(files);
  }, [files]);

  useEffect(() => {
    console.log('Workbench visibility:', showWorkbench);
  }, [showWorkbench]);

  useEffect(() => {
    const handleImportedFiles = (event: Event) => {
      const customEvent = event as CustomEvent<File[]>;
      const importedFiles = customEvent.detail;

      if (importedFiles && importedFiles.length > 0) {
        console.log(`Processing ${importedFiles.length} imported files`);
        
        // Explicitly force the workbench to be visible regardless of current state
        workbenchStore.showWorkbench.set(true);
        console.log("Workbench visibility explicitly set to TRUE");

        // Set import mode flag
        (window as any).__PROJECT_IMPORT_MODE__ = true;

        const processFiles = async () => {
          const processedFiles: Record<string, any> = {};
          let hasPackageJson = false;
          let packageJsonContent = null;
          let packageJsonPath = '';
          
          // Use a platform-agnostic path for the project root
          const projectRoot = 'project';
          
          // First pass: determine project structure and check for package.json
          for (const file of importedFiles) {
            // Use a normalized path format that works across platforms
            const relativePath = file.webkitRelativePath.split('/').join('\\');
            const filePath = `${projectRoot}\\${relativePath}`;
            
            if (file.name === 'package.json') {
              hasPackageJson = true;
              packageJsonPath = filePath;
              console.log(`Found package.json at ${filePath}`);
            }
          }
          
          // Second pass: process all files
          for (const file of importedFiles) {
            try {
              const content = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsText(file);
              });

              // Use a normalized path format
              const relativePath = file.webkitRelativePath.split('/').join('\\');
              const filePath = `${projectRoot}\\${relativePath}`;
              
              // Store package.json content for analysis
              if (filePath === packageJsonPath) {
                try {
                  packageJsonContent = JSON.parse(content);
                  console.log("Parsed package.json:", packageJsonContent);
                } catch (e) {
                  console.error("Error parsing package.json:", e);
                }
              }

              processedFiles[filePath] = {
                content,
                path: filePath,
                name: file.name,
                type: 'file',
              };
            } catch (error) {
              console.error(`Error processing file ${file.name}:`, error);
            }
          }

          // If no package.json was found, create one directly in the project root
          if (!hasPackageJson) {
            const packageJsonPath = `${projectRoot}\\package.json`;
            const basicPackageJson = {
              name: "imported-project",
              version: "1.0.0",
              description: "Imported project",
              main: "index.js",
              scripts: {
                "test": "echo \"Error: no test specified\" && exit 1",
                "start": "node index.js",
                "dev": "node index.js"
              },
              keywords: [],
              author: "",
              license: "ISC"
            };
            
            processedFiles[packageJsonPath] = {
              content: JSON.stringify(basicPackageJson, null, 2),
              path: packageJsonPath,
              name: 'package.json',
              type: 'file'
            };
            
            console.log(`Created default package.json at ${packageJsonPath}`);
          }
          
          // Also create an index.js if none exists
          if (!Object.keys(processedFiles).some(path => path.endsWith('index.js'))) {
            const indexJsPath = `${projectRoot}\\index.js`;
            processedFiles[indexJsPath] = {
              content: 'console.log("Hello from imported project!");\n',
              path: indexJsPath,
              name: 'index.js',
              type: 'file'
            };
            console.log(`Created default index.js at ${indexJsPath}`);
          }

          if (Object.keys(processedFiles).length > 0) {
            try {
              // Get current files from the store
              const currentFiles = workbenchStore.files.get();
              console.log("Current files in store:", Object.keys(currentFiles).length);
              
              // Create updated files object
              const updatedFiles = { ...currentFiles, ...processedFiles };
              console.log("Updated files to store:", Object.keys(updatedFiles).length);
              
              // Update the store with new files
              workbenchStore.files.set(updatedFiles);
              
              // Select package.json first if it exists
              const packageJsonPath = `${projectRoot}\\package.json`;
              if (processedFiles[packageJsonPath]) {
                workbenchStore.setSelectedFile(packageJsonPath);
                console.log("Selected file: package.json");
              } else {
                // Otherwise select the first file
                const firstFilePath = Object.keys(processedFiles)[0];
                if (firstFilePath) {
                  workbenchStore.setSelectedFile(firstFilePath);
                  console.log("Selected file:", firstFilePath);
                }
              }
              
              // Switch to code view
              workbenchStore.currentView.set('code');
              
              // Open terminal and run setup commands
              setTimeout(() => {
                if (!workbenchStore.showTerminal.get()) {
                  workbenchStore.toggleTerminal(true);
                  console.log("Opened terminal");
                }
                
                // When determining project directory path for terminal commands, use appropriate format
                // Note: For terminal commands, we still use forward slashes as they work in both Linux and Windows terminals
                const projectDir = packageJsonPath ? 
                  packageJsonPath.substring(0, packageJsonPath.lastIndexOf('\\')).replace(/\\/g, '/') : 
                  'project';
                
                // Determine which script to run based on package.json
                let runScript = 'start';
                if (packageJsonContent && packageJsonContent.scripts) {
                  if (packageJsonContent.scripts.dev) {
                    runScript = 'dev';
                  } else if (packageJsonContent.scripts.develop) {
                    runScript = 'develop';
                  } else if (packageJsonContent.scripts.serve) {
                    runScript = 'serve';
                  }
                }
                
                // Run initialization commands in the terminal
                const runCommands = () => {
                  try {
                    // Get terminal instance through workbench
                    const terminal = (window as any).terminal || 
                                    (workbenchStore as any).terminal || 
                                    document.querySelector('.xterm-helper-textarea');
                    
                    if (terminal) {
                      // Option 1: If terminal has a write method, use it
                      if (typeof terminal.write === 'function') {
                        terminal.write(`cd ${projectDir}\n`);
                        terminal.write(`npm install\n`);
                        terminal.write(`npm run ${runScript}\n`);
                      } 
                      // Option 2: If terminal has a sendText method, use it
                      else if (typeof terminal.sendText === 'function') {
                        terminal.sendText(`cd ${projectDir}`);
                        terminal.sendText(`npm install`);
                        terminal.sendText(`npm run ${runScript}`);
                      }
                      // Option 3: Dispatch custom event for terminal commands
                      else {
                        window.dispatchEvent(new CustomEvent('terminal:execute', {
                          detail: {
                            commands: [
                              `cd ${projectDir}`,
                              `npm install`,
                              `npm run ${runScript}`
                            ]
                          }
                        }));
                      }
                      
                      console.log(`Running npm install and npm run ${runScript} in ${projectDir}`);
                    } else {
                      console.log("Terminal not found to run commands");
                    }
                  } catch (e) {
                    console.error("Error running terminal commands:", e);
                  }
                };
                
                // Try to run commands after a delay
                setTimeout(runCommands, 1000);
              }, 1000);
              
              toast.success(`Successfully loaded ${Object.keys(processedFiles).length} files into the workbench`);
            } catch (error) {
              console.error("Error updating workbench files:", error);
              toast.error("Error loading files into workbench");
            }
          }
        };

        processFiles().catch((error) => {
          console.error('Error processing imported files:', error);
          toast.error('Failed to process imported files');
        });
      }
    };

    window.addEventListener('workbench:import-files', handleImportedFiles);

    return () => {
      window.removeEventListener('workbench:import-files', handleImportedFiles);
    };
  }, []);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content);
  }, []);

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbenchStore.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath);
  }, []);

  const onFileSave = useCallback(() => {
    workbenchStore.saveCurrentDocument().catch(() => {
      toast.error('Failed to update file content');
    });
  }, []);

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument();
  }, []);

  const saveAllFiles = useCallback(() => {
    workbenchStore.saveAllFiles().then(() => {
      toast.success('All files saved successfully');
    }).catch(() => {
      toast.error('Failed to save some files');
    });
  }, []);

  return (
    effectiveChatStarted ? (
      <>
        <motion.div
          initial="closed"
          animate={showWorkbench ? 'open' : 'closed'}
          variants={workbenchVariants}
          className="z-workbench"
        >
          <div
            className={classNames(
              'fixed top-[calc(var(--header-height)+1.5rem)] bottom-6 w-[var(--workbench-inner-width)] mr-4 z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
              {
                'left-[var(--workbench-left)]': showWorkbench,
                'left-[100%]': !showWorkbench,
              },
            )}
          >
            <div className="absolute inset-0 px-6">
              <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
                <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor">
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                  <div className="ml-auto" />
                  
                  {/* Save All Files Button */}
                  <PanelHeaderButton
                    className="mr-1 text-sm"
                    onClick={saveAllFiles}
                  >
                    <div className="i-ph:floppy-disk" />
                    Save All
                  </PanelHeaderButton>
                  
                  {selectedView === 'code' && (
                    <PanelHeaderButton
                      className="mr-1 text-sm"
                      onClick={() => {
                        workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get());
                      }}
                    >
                      <div className="i-ph:terminal" />
                      Toggle Terminal
                    </PanelHeaderButton>
                  )}
                  <IconButton
                    icon="i-ph:x-circle"
                    className="-mr-1"
                    size="xl"
                    onClick={() => {
                      workbenchStore.showWorkbench.set(false);
                    }}
                  />
                </div>
                
                {/* Unsaved Files Indicator */}
                {unsavedFiles.size > 0 && (
                  <div className="bg-bolt-elements-background-depth-3 py-1 px-3 text-xs text-bolt-elements-textSecondary border-b border-bolt-elements-borderColor">
                    <span className="font-medium text-bolt-accent">{unsavedFiles.size}</span> unsaved {unsavedFiles.size === 1 ? 'file' : 'files'} - click Save All to save changes
                  </div>
                )}

                <div className="relative flex-1 overflow-hidden">
                  <View
                    initial={{ x: selectedView === 'code' ? 0 : '-100%' }}
                    animate={{ x: selectedView === 'code' ? 0 : '-100%' }}
                  >
                    <EditorPanel
                      editorDocument={currentDocument}
                      isStreaming={isStreaming}
                      selectedFile={selectedFile}
                      files={files}
                      unsavedFiles={unsavedFiles}
                      onFileSelect={onFileSelect}
                      onEditorScroll={onEditorScroll}
                      onEditorChange={onEditorChange}
                      onFileSave={onFileSave}
                      onFileReset={onFileReset}
                    />
                  </View>
                  <View
                    initial={{ x: selectedView === 'preview' ? 0 : '100%' }}
                    animate={{ x: selectedView === 'preview' ? 0 : '100%' }}
                  >
                    <Preview />
                  </View>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </>
    ) : null
  );
});

interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
