const { clipboard, contextBridge, ipcRenderer, webUtils } = require('electron');

function toFilePath(file) {
  if (webUtils && typeof webUtils.getPathForFile === 'function') {
    return webUtils.getPathForFile(file);
  }

  return file.path || '';
}

function createDropSubscription(callback) {
  let dragDepth = 0;

  const emit = (payload) => {
    try {
      callback(payload);
    } catch {
      // Renderer callbacks should not break preload event handlers.
    }
  };

  const hasFileDrag = (event) => {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  };

  const handleDragEnter = (event) => {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepth += 1;
    emit({ type: 'enter', paths: [] });
  };

  const handleDragOver = (event) => {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    emit({ type: 'over', paths: [] });
  };

  const handleDragLeave = (event) => {
    if (!hasFileDrag(event) && dragDepth === 0) {
      return;
    }

    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);

    if (dragDepth === 0) {
      emit({ type: 'leave', paths: [] });
    }
  };

  const handleDrop = (event) => {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepth = 0;

    const paths = Array.from(event.dataTransfer?.files ?? [])
      .map(toFilePath)
      .filter(Boolean);

    emit({ type: 'drop', paths });
  };

  window.addEventListener('dragenter', handleDragEnter);
  window.addEventListener('dragover', handleDragOver);
  window.addEventListener('dragleave', handleDragLeave);
  window.addEventListener('drop', handleDrop);

  return () => {
    window.removeEventListener('dragenter', handleDragEnter);
    window.removeEventListener('dragover', handleDragOver);
    window.removeEventListener('dragleave', handleDragLeave);
    window.removeEventListener('drop', handleDrop);
  };
}

contextBridge.exposeInMainWorld('paperquay', {
  invoke(command, args) {
    return ipcRenderer.invoke('paperquay:invoke', command, args ?? {});
  },
  listen(eventName, callback) {
    const handler = (_event, nextEventName, payload) => {
      if (nextEventName === eventName) {
        callback({ event: eventName, payload });
      }
    };

    ipcRenderer.on('paperquay:event', handler);

    return Promise.resolve(() => {
      ipcRenderer.removeListener('paperquay:event', handler);
    });
  },
  window: {
    minimize() {
      return ipcRenderer.invoke('paperquay:window-control', 'minimize');
    },
    toggleMaximize() {
      return ipcRenderer.invoke('paperquay:window-control', 'toggleMaximize');
    },
    close() {
      return ipcRenderer.invoke('paperquay:window-control', 'close');
    },
  },
  clipboard: {
    readText() {
      return clipboard.readText();
    },
    writeText(value) {
      clipboard.writeText(String(value ?? ''));
    },
  },
  onFileDrop(callback) {
    return createDropSubscription(callback);
  },
});
