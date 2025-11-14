(function () {
  // ============ Configuration ============
  const CONFIG = {
    NAME: "List2Cards",
    KEY: "list2cards"
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

  // ============ Main Plugin ============
  JSB.newAddon = () => {
    // Get selected cards
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

    // ============ Card Actions ============
    const refreshMindMap = () => {
      const db = Database.sharedInstance();
      const notebookId = self.studyController.notebookController.notebookId;
      db.setNotebookSyncDirty(notebookId);
      db.savedb();
      NSNotificationCenter.defaultCenter().postNotificationNameObjectUserInfo(
        "RefreshAfterDBChange",
        self,
        { notebookid: notebookId }
      );
    };

    const cardActions = {
      createTree: async (cards) => {
        try {
          if (!cards || !cards.length) {
            showHUD(MESSAGES.NO_CARD, 2);
            return;
          }

          const card = cards[0];
          const text = card.excerptText || card.noteTitle || "";

          if (!text.trim()) {
            showHUD("Card has no text!", 2);
            return;
          }

          const parsed = parseListText(text);

          if (!parsed.valid || parsed.tree.length === 0) {
            showHUD(MESSAGES.PARSE_FAILED, 3);
            return;
          }

          if (parsed.blockText.trim()) {
            card.excerptText = parsed.blockText;
          }

          const count = createCardsFromTree(parsed.tree, card);

          if (count === 0) {
            showHUD("No cards created", 2);
            return;
          }

          refreshMindMap();

          const msg = parsed.blockText.trim()
            ? count + " cards created\n" + parsed.blockText.length + " chars preserved"
            : count + " cards created!";
          showHUD(msg, 3);

        } catch (error) {
          showHUD("ERROR: " + error.message, 3);
        }
      },

      pasteAsTree: async (cards) => {
        try {
          const clipboardText = UIPasteboard.generalPasteboard().string;

          if (!clipboardText || !clipboardText.trim()) {
            showHUD(MESSAGES.CLIPBOARD_EMPTY, 2);
            return;
          }

          const parentCard = cards && cards.length > 0 ? cards[0] : null;
          if (!parentCard) {
            showHUD(MESSAGES.SELECT_PARENT, 2);
            return;
          }

          const parsed = parseListText(clipboardText);

          if (!parsed.valid) {
            showHUD(MESSAGES.MUST_START_WITH_LIST, 3);
            return;
          }

          if (parsed.tree.length === 0) {
            showHUD(MESSAGES.PARSE_FAILED, 3);
            return;
          }

          const count = createCardsFromTree(parsed.tree, parentCard);

          if (count === 0) {
            showHUD("No cards created", 2);
            return;
          }

          refreshMindMap();
          showHUD(count + " cards created as children", 3);

        } catch (error) {
          showHUD("ERROR: " + error.message, 3);
        }
      }
    };

    // ============ Parser ============
    const parseListText = (text) => {
      const lines = text.split("\n");
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

        if (!trimmed) continue;

        const bulletMatch = line.match(/^(\s*)[-*•+○●◦‣]\s+(.+)$/);

        if (bulletMatch) {
          if (!foundFirstBullet) foundFirstBullet = true;

          if (contentLines.length > 0 && currentNode) {
            currentNode.children.push({
              text: contentLines.join("\n"),
              level: contentLevel,
              children: []
            });
            contentLines = [];
          }

          const indent = bulletMatch[1];
          const content = bulletMatch[2].trim();
          const level = indent.replace(/\t/g, "  ").length / 2;

          const node = {
            text: content,
            level: level,
            children: []
          };

          while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            stack.pop();
          }

          const parent = stack[stack.length - 1];
          parent.children.push(node);
          stack.push(node);
          currentNode = node;

        } else {
          if (!foundFirstBullet) {
            return { blockText: "", tree: [], valid: false };
          }

          const indent = line.match(/^(\s*)/)[1];
          const indentLevel = indent.replace(/\t/g, "  ").length / 2;

          if (currentNode && indentLevel > currentNode.level) {
            if (contentLines.length === 0) {
              contentLevel = indentLevel;
            }
            contentLines.push(trimmed);
          } else {
            rootBlockText.push(trimmed);
          }
        }
      }

      if (contentLines.length > 0 && currentNode) {
        currentNode.children.push({
          text: contentLines.join("\n"),
          level: contentLevel,
          children: []
        });
      }

      return {
        blockText: rootBlockText.join("\n"),
        tree: result,
        valid: true
      };
    };

    // ============ Card Creator ============
    const createCardsFromTree = (nodes, parentNote = null) => {
      let count = 0;

      nodes.forEach((node) => {
        try {
          const notebookId = self.studyController.notebookController.notebookId;
          if (!notebookId) {
            showHUD(MESSAGES.NO_NOTEBOOK, 2);
            return;
          }

          const db = Database.sharedInstance();
          const notebook = db.getNotebookById(notebookId);
          if (!notebook) {
            showHUD(MESSAGES.NO_NOTEBOOK, 2);
            return;
          }

          const docMd5 = parentNote ? parentNote.docMd5 : self.studyController.readerController?.docMd5;
          let doc = docMd5 ? db.getDocumentById(docMd5) : null;

          if (!doc && notebook.documents && notebook.documents.length > 0) {
            doc = notebook.documents[0];
          }

          if (!doc) {
            showHUD(MESSAGES.NO_DOCUMENT, 2);
            return;
          }

          const newNote = Note.createWithTitleNotebookDocument(node.text, notebook, doc);

          if (newNote) {
            if (parentNote) {
              if (typeof parentNote.addChild === "function") {
                parentNote.addChild(newNote);
              } else {
                newNote.parentNote = parentNote;
              }
            }

            count++;

            if (node.children && node.children.length > 0) {
              count += createCardsFromTree(node.children, newNote);
            }
          }
        } catch (error) {
          showHUD("ERROR: " + error.message, 2);
        }
      });

      return count;
    };

    // ============ Action Menu ============
    const showActionMenu = async () => {
      const cards = getSelectedCards();

      if (cards.length === 0) {
        showHUD(MESSAGES.NO_CARD, 2);
        return;
      }

      const actions = ["📝 Create Tree", "📋 Paste as Tree"];
      const { option } = await popup(
        "List2Cards",
        cards.length > 0 ? cards[0].noteTitle : "Select an action",
        actions
      );

      if (option === 0) {
        await cardActions.createTree(cards);
      } else if (option === 1) {
        await cardActions.pasteAsTree(cards);
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
        }
      },
      {}
    );
  };
})();
