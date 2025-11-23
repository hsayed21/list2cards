(function () {
  // ============ Configuration ============
  const CONFIG = {
    NAME: "List2Cards",
    KEY: "list2cards",
    PREF_MARKDOWN: "list2cards_use_markdown",
    DEBUG: true
  };

  const MESSAGES = {
    NO_CARD: "No card selected",
    SELECT_PARENT: "Select a parent card first!",
    CLIPBOARD_EMPTY: "Clipboard is empty!\nCopy list text first",
    PARSE_FAILED: "Parse FAILED!\nNo bullet items found",
    MUST_START_WITH_LIST: "ERROR!\nText must start with a list item\nUse: - or * or •",
    NO_NOTEBOOK: "ERROR: No notebook open!",
    NO_DOCUMENT: "ERROR: No document found!",
    CONFIRM: "OK",
    CANCEL: "Cancel"
  };

  // ============ Utilities ============
  const showHUD = (text, duration = 2) => {
    self.app.showHUD(text, self.window, duration);
  };

  const popup = (title, message, buttons = [MESSAGES.CONFIRM]) => {
    return new Promise((resolve) =>
      UIAlertView.showWithTitleMessageStyleCancelButtonTitleOtherButtonTitlesTapBlock(
        title,
        message,
        0,
        MESSAGES.CANCEL,
        buttons,
        (alert, buttonIndex) => {
          resolve({ option: buttonIndex - 1 });
        }
      )
    );
  };

  const selectAndReadFile = () => {
    return new Promise((resolve) => {
      try {
        remoteLog("INFO", "Opening file picker");

        const utis = [
          "public.plain-text",
          "public.text",
          "net.daringfireball.markdown",
        ];

        self.app.openFileWithUTIs(utis, self.studyController, (filePath) => {
          if (!filePath) {
            remoteLog("INFO", "No file selected");
            resolve(null);
            return;
          }

          try {
            remoteLog("INFO", "File selected", { path: filePath });

            const fileContent = MNUtil.readText(filePath);

            if (!fileContent) {
              remoteLog("ERROR", "Failed to read file");
              showHUD("Failed to read file", 2);
              resolve(null);
              return;
            }

            remoteLog("INFO", "File read successfully", {
              contentLength: fileContent.length,
              preview: fileContent.substring(0, 100),
            });

            resolve(fileContent);
          } catch (error) {
            remoteLog("ERROR", "Error reading file", {
              error: error.message,
              path: filePath,
            });
            showHUD("Error reading file: " + error.message, 3);
            resolve(null);
          }
        });
      } catch (error) {
        remoteLog("ERROR", "Error opening file picker", {
          error: error.message,
        });
        resolve(null);
      }
    });
  };

  const getUseMarkdown = () => {
    const userDefaults = NSUserDefaults.standardUserDefaults();
    const value = userDefaults.objectForKey(CONFIG.PREF_MARKDOWN);
    return value === null ? false : value;
  };

  const setUseMarkdown = (value) => {
    const userDefaults = NSUserDefaults.standardUserDefaults();
    userDefaults.setObjectForKey(value, CONFIG.PREF_MARKDOWN);
    userDefaults.synchronize();
  };

  const fetch = (url, options = {}) => {
    return new Promise((resolve, reject) => {
      try {
        const method = options.method || "GET";
        const timeout = options.timeout || 10;

        const request = NSMutableURLRequest.requestWithURL(NSURL.URLWithString(url));
        request.setHTTPMethod(method);
        request.setTimeoutInterval(timeout);

        if (options.headers) {
          Object.keys(options.headers).forEach((key) => {
            request.setValueForHTTPHeaderField(options.headers[key], key);
          });
        }

        const headers = {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/605.1.15",
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(options.headers || {}),
        };

        if (options.json) {
          request.setHTTPBody(NSJSONSerialization.dataWithJSONObjectOptions(options.json, 0));
        } else if (options.body) {
          request.setHTTPBody(NSData.dataWithStringEncoding(options.body, 4));
        } else if (options.form) {
          headers["Content-Type"] = "application/x-www-form-urlencoded";
          const formData = Object.keys(options.form)
            .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options.form[key])}`)
            .join("&");
          request.setHTTPBody(NSData.dataWithStringEncoding(formData, 4));
        }

        request.setAllHTTPHeaderFields(headers);

        // Make request
        NSURLConnection.sendAsynchronousRequestQueueCompletionHandler(
          request,
          NSOperationQueue.mainQueue(),
          (response, data, error) => {
            if (error) {
              reject(new Error(error.localizedDescription));
              return;
            }

            if (!data || data.length() === 0) {
              // Empty response is OK for fire-and-forget logging
              resolve({
                json: () => ({}),
                text: () => "",
              });
              return;
            }

            const encoding = data.base64Encoding();
            const decoding = NSString.alloc()
              .initWithDataEncoding(NSData.alloc().initWithBase64EncodedStringOptions(encoding, 0), 4)
              .toString();

            resolve({
              json: () => {
                try {
                  return JSON.parse(decoding);
                } catch (e) {
                  JSB.log(`${Addon.key}: JSON parse error: ${e.message}`);
                  return {};
                }
              },
              text: () => decoding,
            });
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  };

  const remoteLog = async (level, message, data = {}) => {
    try {
      JSB.log(`${CONFIG.KEY} [${level}]: ${message}`);

      const payload = {
        level: level,
        message: message,
        plugin: CONFIG.KEY,
        timestamp: new Date().toISOString(),
        ...data,
      };

      const url = "https://your-ngrok-url.ngrok-free.dev/log";

      fetch(url, {
        method: "POST",
        json: payload,
        timeout: 5,
      })
        .then(() => {
          JSB.log(`${CONFIG.KEY}: ✓ Remote log sent`);
        })
        .catch((e) => {
          JSB.log(`${CONFIG.KEY}: ✗ Remote log failed: ${e.message}`);
        });
    } catch (e) {
      JSB.log(`${CONFIG.KEY}: Remote log error: ${e.message}`);
    }
  };

  JSB.newAddon = () => {
    const getSelectedCards = () => {
      const focusNote = self.studyController.focusNote;
      if (focusNote && focusNote.noteId) {
        return [focusNote];
      }

      const notebookController = self.studyController.notebookController;
      if (notebookController && notebookController.focusNote) {
        return [notebookController.focusNote];
      }

      const mindMapView = self.studyController.mindMapView;
      if (mindMapView && mindMapView.selViewLst) {
        const selectedNodes = mindMapView.selViewLst;
        if (selectedNodes.length > 0) {
          const notes = selectedNodes.map((node) => node.note).filter((n) => n);
          if (notes.length > 0) {
            return notes;
          }
        }
      }

      return [];
    };

    const getOrCreateDocument = (parentNote = null) => {
      const db = Database.sharedInstance();
      const notebookId = self.studyController.notebookController.notebookId;

      if (!notebookId) {
        remoteLog("ERROR", "getOrCreateDocument: No notebookId available");
        return null;
      }

      const notebook = db.getNotebookById(notebookId);
      if (!notebook) {
        remoteLog("ERROR", "getOrCreateDocument: Notebook not found", { notebookId });
        return null;
      }

      let docMd5 = null;
      let doc = null;

      // ========== Strategy 0: Try notebook.mainDocMd5 (NEW - most reliable for notebook placeholders) ==========
      if (notebook.mainDocMd5) {
        doc = db.getDocumentById(notebook.mainDocMd5);
        if (doc) {
          remoteLog("DEBUG", "getOrCreateDocument: ✓ Strategy 0 SUCCESS - Using notebook's mainDocMd5", {
            docMd5: doc.docMd5,
            docTitle: doc.docTitle || "(untitled)",
            strategy: "notebook.mainDocMd5",
            note: "This is the preferred method for notebook placeholders!",
          });
          return doc;
        }
        remoteLog("DEBUG", "getOrCreateDocument: Strategy 0 - notebook.mainDocMd5 not in DB", {
          mainDocMd5: notebook.mainDocMd5,
          nextStep: "Trying parent note's docMd5",
        });
      }

      // ========== Strategy 1: Get from parent note's docMd5 ==========
      if (parentNote && parentNote.docMd5) {
        docMd5 = parentNote.docMd5;

        // Try to get document from DB (works for real MD5s, "00000000", or persistent notebook placeholders)
        doc = db.getDocumentById(docMd5);
        if (doc) {
          remoteLog("DEBUG", "getOrCreateDocument: ✓ Strategy 1 SUCCESS - Using parent note's document", {
            docMd5: doc.docMd5,
            docTitle: doc.docTitle || "(untitled)",
            strategy: "Parent docMd5",
          });
          return doc;
        }

        // Document not found - normal for notebooks without imported documents
        remoteLog(
          "DEBUG",
          "getOrCreateDocument: Strategy 1 - Parent docMd5 not in DB (expected for non-document notebooks)",
          {
            docMd5,
            nextStep: "Will try other strategies to find a valid document",
          }
        );
      } // ========== Strategy 2: Get from currentDocumentController.docMd5 ==========
      try {
        const readerController = self.studyController.readerController;
        const currentDocController = readerController?.currentDocumentController;

        if (currentDocController && currentDocController.docMd5) {
          docMd5 = currentDocController.docMd5;

          // Try to get document from DB (works for real MD5s, "00000000", or persistent notebook placeholders)
          doc = db.getDocumentById(docMd5);
          if (doc) {
            remoteLog(
              "DEBUG",
              "getOrCreateDocument: ✓ Strategy 2 SUCCESS - Using current document controller's document",
              {
                docMd5: doc.docMd5,
                docTitle: doc.docTitle || "(placeholder)",
                strategy: "Controller docMd5",
              }
            );
            return doc;
          }

          // Document not found - normal for notebooks without imported documents
          remoteLog(
            "DEBUG",
            "getOrCreateDocument: Strategy 2 - Controller docMd5 not in DB (expected behavior)",
            {
              docMd5,
              nextStep: "Continuing to Strategy 3",
            }
          );
        }
      } catch (e) {
        remoteLog("DEBUG", "getOrCreateDocument: Strategy 2 - Error accessing currentDocumentController", {
          error: e.message,
          nextStep: "Continuing to Strategy 3",
        });
      }

      // ========== Strategy 3: Get document object directly from controller ==========
      try {
        const currentDoc = self.studyController.readerController?.currentDocumentController?.document;
        if (currentDoc) {
          remoteLog(
            "DEBUG",
            "getOrCreateDocument: ✓ Strategy 3 SUCCESS - Using document object from controller",
            {
              docMd5: currentDoc.docMd5,
              docTitle: currentDoc.docTitle || "(untitled)",
              strategy: "Controller document object",
            }
          );
          return currentDoc;
        }
      } catch (e) {
        remoteLog("DEBUG", "getOrCreateDocument: Strategy 3 - Error accessing document from controller", {
          error: e.message,
          nextStep: "Continuing to Strategy 4",
        });
      }

      // ========== Strategy 4: Get first document from notebook.documents ==========
      if (notebook.documents && notebook.documents.length > 0) {
        doc = notebook.documents[0];
        remoteLog(
          "DEBUG",
          "getOrCreateDocument: ✓ Strategy 4 SUCCESS - Using first document from notebook.documents",
          {
            docMd5: doc.docMd5,
            docTitle: doc.docTitle || "(untitled)",
            totalDocs: notebook.documents.length,
            strategy: "Notebook documents array",
          }
        );
        return doc;
      }

      // ========== Strategy 5: Try known standard placeholders ==========
      const knownPlaceholders = ["00000000", "0cbc6611f5540bd0809a388dc95a615b"];
      for (const placeholder of knownPlaceholders) {
        doc = db.getDocumentById(placeholder);
        if (doc) {
          remoteLog("DEBUG", "getOrCreateDocument: ✓ Strategy 5 SUCCESS - Using known placeholder document", {
            docMd5: doc.docMd5,
            placeholder: placeholder,
            docTitle: doc.docTitle || "(untitled)",
            strategy: "Known placeholders",
          });
          return doc;
        }
      }
      remoteLog(
        "DEBUG",
        "getOrCreateDocument: Strategy 5 - Known placeholders not in DB, trying smart search"
      );

      // ========== Strategy 6: Smart search for "Notebook Document" titled documents ==========
      try {
        const allDocs = db.allDocuments();
        if (allDocs && allDocs.length > 0) {
          // First, try to find a "Notebook Document" (MarginNote's auto-created placeholder documents)
          const notebookDoc = allDocs.find((d) => d.docTitle && d.docTitle.startsWith("Notebook Document"));
          if (notebookDoc) {
            remoteLog(
              "DEBUG",
              "getOrCreateDocument: ✓ Strategy 6 SUCCESS - Found 'Notebook Document' placeholder",
              {
                docMd5: notebookDoc.docMd5,
                docTitle: notebookDoc.docTitle,
                totalDocs: allDocs.length,
                strategy: "Smart search for Notebook Document",
                note: "This is the ideal placeholder for notebooks without PDFs",
              }
            );
            return notebookDoc;
          }

          // Otherwise, use first available document
          doc = allDocs[0];
          remoteLog(
            "DEBUG",
            "getOrCreateDocument: ✓ Strategy 6 SUCCESS - Using first available document from database",
            {
              docMd5: doc.docMd5,
              docTitle: doc.docTitle || "(untitled)",
              totalDocs: allDocs.length,
              strategy: "db.allDocuments() fallback",
              note: "This is NORMAL for notebooks without imported PDFs/EPUBs",
            }
          );
          return doc;
        }
      } catch (e) {
        remoteLog("DEBUG", "getOrCreateDocument: Strategy 6 - Error accessing allDocuments", {
          error: e.message,
        });
      }

      // ========== All strategies failed ==========
      remoteLog("ERROR", "getOrCreateDocument: ✗✗✗ CRITICAL - All strategies failed, cannot create cards", {
        notebookId: notebookId,
        notebookTitle: notebook.title,
        hasNotebookDocs: !!(notebook.documents && notebook.documents.length > 0),
        hasParent: !!parentNote,
        mainDocMd5: notebook.mainDocMd5 || "(none)",
        issue: "Database may be empty or inaccessible",
      });

      return null;
    };

    // ============ Card Actions ============
    const refreshMindMap = () => {
      const db = Database.sharedInstance();
      const notebookId = self.studyController.notebookController.notebookId;
      db.setNotebookSyncDirty(notebookId);
      db.savedb();
      NSNotificationCenter.defaultCenter().postNotificationNameObjectUserInfo("RefreshAfterDBChange", self, {
        notebookid: notebookId,
      });
    };

    const cardActions = {
      createTree: async (cards) => {
        try {
          remoteLog("INFO", "createTree started", { cardsCount: cards ? cards.length : 0 });
          if (!cards || !cards.length) {
            remoteLog("ERROR", "No cards provided");
            showHUD(MESSAGES.NO_CARD, 2);
            return;
          }

          const card = cards[0];
          const text = card.excerptText || card.noteTitle || "";
          remoteLog("INFO", "Card content retrieved", {
            cardId: card.noteId,
            textLength: text.length,
            textPreview: text.substring(0, 200),
          });

          if (!text.trim()) {
            remoteLog("ERROR", "Card has no text", { cardId: card.noteId });
            showHUD("Card has no text!", 2);
            return;
          }

          const parsed = parseListText(text);
          remoteLog("INFO", "Parse completed", {
            valid: parsed.valid,
            treeLength: parsed.tree.length,
            blockTextLength: parsed.blockText.length,
            tree: JSON.stringify(parsed.tree).substring(0, 500),
          });

          if (!parsed.valid || parsed.tree.length === 0) {
            remoteLog("ERROR", "Parse failed", {
              valid: parsed.valid,
              treeLength: parsed.tree.length,
              textPreview: text.substring(0, 200),
            });
            showHUD(MESSAGES.PARSE_FAILED, 3);
            return;
          }

          if (parsed.blockText.trim()) {
            card.excerptText = parsed.blockText;
          }

          const count = createCardsFromTree(parsed.tree, card);
          remoteLog("INFO", "Cards created", { count: count });

          if (count === 0) {
            remoteLog("ERROR", "No cards were created despite valid parse");
            showHUD("No cards created", 2);
            return;
          }

          refreshMindMap();
          remoteLog("SUCCESS", "createTree completed", { cardsCreated: count });

          const msg = parsed.blockText.trim()
            ? count + " cards created\n" + parsed.blockText.length + " chars preserved"
            : count + " cards created!";
          showHUD(msg, 3);
        } catch (error) {
          remoteLog("EXCEPTION", "createTree failed", {
            error: error.message,
            stack: error.stack,
          });
          showHUD("ERROR: " + error.message, 3);
        }
      },

      pasteAsTree: async (cards) => {
        try {
          remoteLog("INFO", "pasteAsTree started");

          const clipboardText = UIPasteboard.generalPasteboard().string;

          if (!clipboardText || !clipboardText.trim()) {
            remoteLog("ERROR", "Clipboard is empty");
            showHUD(MESSAGES.CLIPBOARD_EMPTY, 2);
            return;
          }

          remoteLog("INFO", "Clipboard content", {
            length: clipboardText.length,
            preview: clipboardText.substring(0, 200),
          });

          const parentCard = cards && cards.length > 0 ? cards[0] : null;
          if (!parentCard) {
            remoteLog("ERROR", "No parent card selected");
            showHUD(MESSAGES.SELECT_PARENT, 2);
            return;
          }

          const parsed = parseListText(clipboardText);
          remoteLog("INFO", "Parse completed", {
            valid: parsed.valid,
            treeLength: parsed.tree.length,
          });

          if (!parsed.valid) {
            remoteLog("ERROR", "Parse failed - invalid format", {
              textPreview: clipboardText.substring(0, 200),
            });
            showHUD(MESSAGES.MUST_START_WITH_LIST, 3);
            return;
          }

          if (parsed.tree.length === 0) {
            remoteLog("ERROR", "No bullet items found");
            showHUD(MESSAGES.PARSE_FAILED, 3);
            return;
          }

          const count = createCardsFromTree(parsed.tree, parentCard);
          remoteLog("INFO", "Cards created", { count: count });

          if (count === 0) {
            remoteLog("ERROR", "No cards created despite valid parse");
            showHUD("No cards created", 2);
            return;
          }

          refreshMindMap();
          remoteLog("SUCCESS", "pasteAsTree completed", { cardsCreated: count });
          showHUD(count + " cards created as children", 3);
        } catch (error) {
          remoteLog("EXCEPTION", "pasteAsTree failed", {
            error: error.message,
            stack: error.stack,
          });
          showHUD("ERROR: " + error.message, 3);
        }
      },

      updateTreeFromClipboard: async (cards) => {
        try {
          remoteLog("INFO", "updateTreeFromClipboard started");

          const clipboardText = UIPasteboard.generalPasteboard().string;

          if (!clipboardText || !clipboardText.trim()) {
            remoteLog("ERROR", "Clipboard is empty");
            showHUD(MESSAGES.CLIPBOARD_EMPTY, 2);
            return;
          }

          remoteLog("INFO", "Clipboard content", {
            length: clipboardText.length,
            preview: clipboardText.substring(0, 200),
          });

          const parentCard = cards && cards.length > 0 ? cards[0] : null;
          if (!parentCard) {
            remoteLog("ERROR", "No parent card selected");
            showHUD(MESSAGES.SELECT_PARENT, 2);
            return;
          }

          const parsed = parseListText(clipboardText);
          remoteLog("INFO", "Parse completed", {
            valid: parsed.valid,
            treeLength: parsed.tree.length,
          });

          if (!parsed.valid) {
            remoteLog("ERROR", "Parse failed - invalid format", {
              textPreview: clipboardText.substring(0, 200),
            });
            showHUD(MESSAGES.MUST_START_WITH_LIST, 3);
            return;
          }

          if (parsed.tree.length === 0) {
            remoteLog("ERROR", "No bullet items found");
            showHUD(MESSAGES.PARSE_FAILED, 3);
            return;
          }

          const existingChildren = parentCard.childNotes || [];
          remoteLog("INFO", "Existing children count", { count: existingChildren.length });

          const existingCardsMap = new Map();
          existingChildren.forEach((child) => {
            const text = (child.excerptText || child.noteTitle || "").trim();
            const normalizedText = normalizeCardText(text);
            existingCardsMap.set(normalizedText, child);
            remoteLog("DEBUG", "Mapped existing card", {
              noteId: child.noteId,
              text: text.substring(0, 50),
              normalized: normalizedText.substring(0, 50),
            });
          });

          // Merge tree: add only new cards
          const stats = mergeTreeWithExisting(parsed.tree, parentCard, existingCardsMap);

          remoteLog("INFO", "Merge completed", stats);

          if (stats.added === 0 && stats.skipped === 0) {
            showHUD("No changes made", 2);
            return;
          }

          refreshMindMap();
          remoteLog("SUCCESS", "updateTreeFromClipboard completed", stats);

          const msg = `✓ Updated!\n+${stats.added} new, ~${stats.skipped} kept, ↻${stats.updated} updated`;
          showHUD(msg, 3);
        } catch (error) {
          remoteLog("EXCEPTION", "updateTreeFromClipboard failed", {
            error: error.message,
            stack: error.stack,
          });
          showHUD("ERROR: " + error.message, 3);
        }
      },

      updateTreeFromFile: async (cards) => {
        try {
          remoteLog("INFO", "updateTreeFromFile started");

          const parentCard = cards && cards.length > 0 ? cards[0] : null;
          if (!parentCard) {
            remoteLog("ERROR", "No parent card selected");
            showHUD(MESSAGES.SELECT_PARENT, 2);
            return;
          }

          showHUD("Select a file...", 1);
          const fileContent = await selectAndReadFile();

          if (!fileContent) {
            remoteLog("ERROR", "No file selected or file is empty");
            showHUD("No file selected", 2);
            return;
          }

          remoteLog("INFO", "File content loaded", {
            length: fileContent.length,
            preview: fileContent.substring(0, 200),
          });

          showHUD("Processing file...", 1);

          let parsed;
          try {
            parsed = parseListText(fileContent);
          } catch (parseError) {
            remoteLog("ERROR", "Parse exception", {
              error: parseError.message,
              stack: parseError.stack,
            });
            showHUD("Failed to parse file", 2);
            return;
          }

          remoteLog("INFO", "Parse completed", {
            valid: parsed.valid,
            treeLength: parsed.tree.length,
          });

          if (!parsed.valid) {
            remoteLog("ERROR", "Parse failed - invalid format", {
              textPreview: fileContent.substring(0, 200),
            });
            showHUD(MESSAGES.MUST_START_WITH_LIST, 3);
            return;
          }

          if (parsed.tree.length === 0) {
            remoteLog("ERROR", "No bullet items found");
            showHUD(MESSAGES.PARSE_FAILED, 3);
            return;
          }

          const existingChildren = parentCard.childNotes || [];
          remoteLog("INFO", "Existing children count", { count: existingChildren.length });

          const existingCardsMap = new Map();
          existingChildren.forEach((child) => {
            const text = (child.excerptText || child.noteTitle || "").trim();
            const normalizedText = normalizeCardText(text);
            existingCardsMap.set(normalizedText, child);
            remoteLog("DEBUG", "Mapped existing card", {
              noteId: child.noteId,
              text: text.substring(0, 50),
              normalized: normalizedText.substring(0, 50),
            });
          });

          showHUD("Merging cards...", 1);

          // Merge tree: add only new cards
          let stats;
          try {
            stats = mergeTreeWithExisting(parsed.tree, parentCard, existingCardsMap);
          } catch (mergeError) {
            remoteLog("ERROR", "Merge exception", {
              error: mergeError.message,
              stack: mergeError.stack,
            });
            showHUD("Failed to merge cards", 2);
            return;
          }

          remoteLog("INFO", "Merge completed", stats);

          if (stats.added === 0 && stats.skipped === 0) {
            showHUD("No changes made", 2);
            return;
          }

          refreshMindMap();
          remoteLog("SUCCESS", "updateTreeFromFile completed", stats);

          const msg = `✓ Updated from file!\n+${stats.added} new, ~${stats.skipped} kept, ↻${stats.updated} updated`;
          showHUD(msg, 3);
        } catch (error) {
          remoteLog("EXCEPTION", "updateTreeFromFile failed", {
            error: error.message,
            stack: error.stack,
          });
          showHUD("ERROR: " + error.message, 3);
        }
      },
    };

    // ============ Parser ============
    const normalizeCardText = (text) => {
      // Normalize text for comparison:
      // - Trim whitespace
      // - Convert to lowercase
      // - Remove extra spaces
      // - Remove common punctuation variations
      return text
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[.,:;!?]+$/g, ""); // Remove trailing punctuation
    };

    const mergeTreeWithExisting = (nodes, parentNote, existingCardsMap) => {
      let stats = { added: 0, skipped: 0, updated: 0 };
      const useMarkdown = getUseMarkdown();

      nodes.forEach((node, index) => {
        try {
          const normalizedText = normalizeCardText(node.text);

          remoteLog("DEBUG", `Processing node ${index}`, {
            nodeText: node.text.substring(0, 50),
            normalizedText: normalizedText.substring(0, 50),
            hasChildren: !!(node.children && node.children.length > 0),
          });

          const existingCard = existingCardsMap.get(normalizedText);

          if (existingCard) {
            // Card exists - skip creating but process children
            remoteLog("DEBUG", "Card already exists, skipping", {
              nodeText: node.text.substring(0, 50),
              existingCardId: existingCard.noteId,
            });
            stats.skipped++;

            // Process children recursively
            if (node.children && node.children.length > 0) {
              const existingChildren = existingCard.childNotes || [];
              const childCardsMap = new Map();
              existingChildren.forEach((child) => {
                const text = (child.excerptText || child.noteTitle || "").trim();
                const normalized = normalizeCardText(text);
                childCardsMap.set(normalized, child);
              });

              const childStats = mergeTreeWithExisting(node.children, existingCard, childCardsMap);
              stats.added += childStats.added;
              stats.skipped += childStats.skipped;
              stats.updated += childStats.updated;
            }
          } else {
            // Card doesn't exist - create it
            remoteLog("DEBUG", "Card is new, creating", {
              nodeText: node.text.substring(0, 50),
            });

            const notebookId = self.studyController.notebookController.notebookId;
            if (!notebookId) {
              remoteLog("ERROR", "No notebookId found", { nodeIndex: index });
              return;
            }

            const db = Database.sharedInstance();
            const notebook = db.getNotebookById(notebookId);
            if (!notebook) {
              remoteLog("ERROR", "Notebook object not found", { notebookId, nodeIndex: index });
              return;
            }

            const doc = getOrCreateDocument(parentNote);
            if (!doc) {
              remoteLog("ERROR", "No document object found - cannot create note", {
                notebookId: notebookId,
                nodeIndex: index,
              });
              return;
            }

            let newNote = null;
            try {
              newNote = Note.createWithTitleNotebookDocument("", notebook, doc);
              newNote.excerptText = node.text;
              if (useMarkdown) {
                newNote.excerptTextMarkdown = true;
              }
              remoteLog("DEBUG", "Note created successfully", {
                noteId: newNote ? newNote.noteId : "null",
                docMd5: doc.docMd5,
              });
            } catch (e) {
              remoteLog("ERROR", "Failed to create note", {
                error: e.message,
                stack: e.stack,
                nodeText: node.text,
                docMd5: doc.docMd5,
              });
              return;
            }

            if (!newNote) {
              remoteLog("ERROR", "Card creation failed", {
                nodeText: node.text,
                nodeIndex: index,
              });
              return;
            }

            if (parentNote) {
              if (typeof parentNote.addChild === "function") {
                parentNote.addChild(newNote);
              } else {
                newNote.parentNote = parentNote;
              }
            }

            db.setNotebookSyncDirty(notebookId);
            stats.added++;

            // Add to map for future comparisons
            existingCardsMap.set(normalizedText, newNote);

            // Process children recursively
            if (node.children && node.children.length > 0) {
              const childCardsMap = new Map();
              const childStats = mergeTreeWithExisting(node.children, newNote, childCardsMap);
              stats.added += childStats.added;
              stats.skipped += childStats.skipped;
              stats.updated += childStats.updated;
            }
          }
        } catch (error) {
          remoteLog("ERROR", "Exception in mergeTreeWithExisting", {
            error: error.message,
            stack: error.stack,
            nodeText: node.text,
          });
        }
      });

      // Save database after all operations
      if (stats.added > 0) {
        const notebookId = self.studyController.notebookController.notebookId;
        const db = Database.sharedInstance();
        db.savedb();
      }

      return stats;
    };

    const parseListText = (text) => {
      remoteLog("DEBUG", "parseListText started", { textLength: text.length });

      const lines = text.split("\n");
      remoteLog("DEBUG", "Split into lines", { totalLines: lines.length });

      const result = [];
      const stack = [{ level: -1, children: result }];
      let rootBlockText = [];
      let currentNode = null;
      let contentLines = [];
      let contentLevel = -1;
      let foundFirstBullet = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
          remoteLog("DEBUG", `Line ${i}: empty, skipping`);
          continue;
        }

        const bulletMatch = line.match(/^(\s*)[-*•+○●◦‣]\s+(.+)$/);

        if (bulletMatch) {
          remoteLog("DEBUG", `Line ${i}: BULLET detected`, {
            line: trimmed,
            rawLine: line,
          });

          if (!foundFirstBullet) {
            foundFirstBullet = true;
            remoteLog("INFO", "First bullet found", { lineNumber: i, content: trimmed });
          }

          if (contentLines.length > 0 && currentNode) {
            // Normalize indentation: remove base indentation from all lines
            const firstLineIndent = contentLines[0].match(/^(\s*)/)[1].length;
            const normalizedLines = contentLines.map((line) => {
              // Remove the base indentation amount from each line
              const lineIndent = line.match(/^(\s*)/)[1].length;
              if (lineIndent >= firstLineIndent) {
                return line.substring(firstLineIndent);
              }
              return line.trimStart(); // If line has less indent, just trim it
            });
            const contentText = normalizedLines.join("\n");
            remoteLog("DEBUG", "Adding content lines to previous node", {
              contentLength: contentText.length,
              linesCount: contentLines.length,
              baseIndentRemoved: firstLineIndent,
            });
            currentNode.children.push({
              text: contentText,
              level: contentLevel,
              children: [],
            });
            contentLines = [];
          }

          const indent = bulletMatch[1];
          const content = bulletMatch[2].trim();
          const level = indent.replace(/\t/g, "  ").length / 2;

          remoteLog("DEBUG", `Bullet parsed`, {
            lineNumber: i,
            indentChars: indent.length,
            level: level,
            content: content.substring(0, 50),
          });

          const node = {
            text: content,
            level: level,
            children: [],
          };

          while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            const popped = stack.pop();
            remoteLog("DEBUG", `Popped from stack`, {
              poppedLevel: popped.level,
              currentLevel: level,
            });
          }

          const parent = stack[stack.length - 1];
          parent.children.push(node);
          stack.push(node);
          currentNode = node;

          remoteLog("DEBUG", `Node added to tree`, {
            nodeLevel: level,
            stackDepth: stack.length,
            parentLevel: parent.level,
          });
        } else {
          remoteLog("DEBUG", `Line ${i}: TEXT (non-bullet)`, {
            line: trimmed,
            foundFirstBullet: foundFirstBullet,
          });

          if (!foundFirstBullet) {
            remoteLog("ERROR", "Parse failed - text before first bullet", {
              lineNumber: i,
              lineContent: trimmed,
            });
            return { blockText: "", tree: [], valid: false };
          }

          const indent = line.match(/^(\s*)/)[1];
          const indentLevel = indent.replace(/\t/g, "  ").length / 2;

          if (currentNode && indentLevel > currentNode.level) {
            if (contentLines.length === 0) {
              contentLevel = indentLevel;
              remoteLog("DEBUG", `Starting content collection`, {
                contentLevel: contentLevel,
                currentNodeLevel: currentNode.level,
              });
            }
            // Preserve original line with indentation (don't use trimmed)
            contentLines.push(line);
            remoteLog("DEBUG", `Added to content lines`, {
              contentLinesCount: contentLines.length,
            });
          } else {
            rootBlockText.push(trimmed);
            remoteLog("DEBUG", `Added to root block text`, {
              blockTextLinesCount: rootBlockText.length,
            });
          }
        }
      }

      if (contentLines.length > 0 && currentNode) {
        // Normalize indentation: remove base indentation from all lines
        const firstLineIndent = contentLines[0].match(/^(\s*)/)[1].length;
        const normalizedLines = contentLines.map((line) => {
          // Remove the base indentation amount from each line
          const lineIndent = line.match(/^(\s*)/)[1].length;
          if (lineIndent >= firstLineIndent) {
            return line.substring(firstLineIndent);
          }
          return line.trimStart(); // If line has less indent, just trim it
        });
        const contentText = normalizedLines.join("\n");
        remoteLog("DEBUG", "Adding final content lines", {
          contentLength: contentText.length,
          linesCount: contentLines.length,
          baseIndentRemoved: firstLineIndent,
        });
        currentNode.children.push({
          text: contentText,
          level: contentLevel,
          children: [],
        });
      }

      const parseResult = {
        blockText: rootBlockText.join("\n"),
        tree: result,
        valid: true,
      };

      remoteLog("DEBUG", "parseListText completed", {
        valid: parseResult.valid,
        treeLength: parseResult.tree.length,
        blockTextLength: parseResult.blockText.length,
        treePreview: JSON.stringify(parseResult.tree).substring(0, 300),
      });

      remoteLog("INFO", "Parse result summary", {
        totalBulletsFound: result.length,
        hasBlockText: parseResult.blockText.length > 0,
        treeStructure: JSON.stringify(result, null, 2).substring(0, 500),
      });

      return parseResult;
    };

    // ============ Card Creator ============
    const createCardsFromTree = (nodes, parentNote = null) => {
      remoteLog("DEBUG", "createCardsFromTree started", {
        nodeCount: nodes.length,
        hasParent: !!parentNote,
        parentId: parentNote ? parentNote.noteId : null,
      });
      let count = 0;
      const useMarkdown = getUseMarkdown();

      nodes.forEach((node, index) => {
        try {
          remoteLog("DEBUG", `Processing node ${index}`, {
            nodeText: node.text,
            nodeLevel: node.level,
            hasChildren: !!(node.children && node.children.length > 0),
          });

          const notebookId = self.studyController.notebookController.notebookId;
          if (!notebookId) {
            remoteLog("ERROR", "No notebookId found", { nodeIndex: index });
            showHUD(MESSAGES.NO_NOTEBOOK, 2);
            return;
          }

          const db = Database.sharedInstance();
          const notebook = db.getNotebookById(notebookId);
          if (!notebook) {
            remoteLog("ERROR", "Notebook object not found", { notebookId, nodeIndex: index });
            showHUD(MESSAGES.NO_NOTEBOOK, 2);
            return;
          }

          const doc = getOrCreateDocument(parentNote);
          if (!doc) {
            remoteLog("ERROR", "No document object found - cannot create note", {
              notebookId: notebookId,
              nodeIndex: index,
            });
            showHUD(MESSAGES.NO_DOCUMENT, 2);
            return;
          }

          remoteLog("DEBUG", "Creating card with Note.createWithTitleNotebookDocument", {
            nodeText: node.text,
            notebookId: notebookId,
            notebookTitle: notebook.title,
            docMd5: doc.docMd5,
            docTitle: doc.docTitle || "(placeholder)",
            nodeIndex: index,
          });

          let newNote = null;
          try {
            newNote = Note.createWithTitleNotebookDocument("", notebook, doc);
            newNote.excerptText = node.text;
            remoteLog("DEBUG", "Note created successfully", {
              noteId: newNote ? newNote.noteId : "null",
              docMd5: doc.docMd5,
            });
          } catch (e) {
            remoteLog("ERROR", "Failed to create note", {
              error: e.message,
              stack: e.stack,
              nodeText: node.text,
              docMd5: doc.docMd5,
            });
          }

          if (!newNote) {
            remoteLog("ERROR", "Card creation failed - all methods exhausted", {
              nodeText: node.text,
              notebookId: notebookId,
              nodeIndex: index,
            });
            return;
          }

          if (useMarkdown) {
            newNote.excerptTextMarkdown = true;
          }

          remoteLog("DEBUG", "Card created successfully", {
            newNoteId: newNote.noteId,
            nodeText: node.text,
            nodeIndex: index,
            useMarkdown: useMarkdown,
          });

          if (parentNote) {
            if (typeof parentNote.addChild === "function") {
              parentNote.addChild(newNote);
              remoteLog("DEBUG", "Linked to parent using addChild", {
                parentId: parentNote.noteId,
              });
            } else {
              newNote.parentNote = parentNote;
              remoteLog("DEBUG", "Linked to parent using parentNote property", {
                parentId: parentNote.noteId,
              });
            }
          }

          db.setNotebookSyncDirty(notebookId);

          count++;

          if (node.children && node.children.length > 0) {
            const childCount = createCardsFromTree(node.children, newNote);
            count += childCount;
          }
        } catch (error) {
          remoteLog("ERROR", "Exception in card creation", {
            error: error.message,
            stack: error.stack,
            nodeText: node.text,
          });
          showHUD("ERROR: " + error.message, 2);
        }
      });

      if (count > 0) {
        const notebookId = self.studyController.notebookController.notebookId;
        const db = Database.sharedInstance();
        db.savedb();

        // Refresh UI
        self.studyController.refreshAddonCommands();
        NSNotificationCenter.defaultCenter().postNotificationNameObjectUserInfo(
          "RefreshAfterDBChange",
          self,
          { notebookid: notebookId }
        );
      }

      remoteLog("DEBUG", "createCardsFromTree completed", { cardsCreated: count });
      return count;
    };

    const showActionMenu = async () => {
      const cards = getSelectedCards();

      if (cards.length === 0) {
        showHUD(MESSAGES.NO_CARD, 2);
        return;
      }

      const useMarkdown = getUseMarkdown();
      const formatIcon = useMarkdown ? "📝" : "📄";
      const formatLabel = useMarkdown ? "Markdown ON" : "Markdown OFF";

      const actions = [
        "📝 Create Tree",
        "📋 Paste as Tree",
        "🔄 Update Tree from Clipboard",
        "📁 Update Tree from File",
        formatIcon + " " + formatLabel,
      ];

      const { option } = await popup(
        "List2Cards",
        cards.length > 0 ? cards[0].noteTitle : "Select an action",
        actions
      );

      if (option === 0) {
        await cardActions.createTree(cards);
      } else if (option === 1) {
        await cardActions.pasteAsTree(cards);
      } else if (option === 2) {
        await cardActions.updateTreeFromClipboard(cards);
      } else if (option === 3) {
        await cardActions.updateTreeFromFile(cards);
      } else if (option === 4) {
        setUseMarkdown(!useMarkdown);
        const newState = !useMarkdown ? "Markdown ON" : "Markdown OFF";
        showHUD("Format: " + newState, 2);
      }
    };

    // ============ Plugin Class ============
    return JSB.defineClass(
      CONFIG.NAME + ": JSExtension",
      {
        sceneWillConnect() {
          self.status = false;
          self.app = Application.sharedInstance();
          self.studyController = self.app.studyController(self.window);
        },

        sceneDidDisconnect() {
          // Cleanup if needed
        },

        queryAddonCommandStatus() {
          return self.studyController.studyMode !== 3
            ? {
                image: "logo_44x44.png",
                object: self,
                selector: "onToggle:",
                checked: self.status,
              }
            : null;
        },

        async onToggle() {
          self.status = true;
          self.studyController.refreshAddonCommands();
          await showActionMenu();
          self.status = false;
          self.studyController.refreshAddonCommands();
        },
      },
      {}
    );
  };
})();
