import { icon, TextQuote, X } from '../../../shared/icons.js';
import { t } from '../../../shared/i18n.js';
import { setupTextAttachmentViewer } from './text-attachment-viewer.js';
import { composeMessageWithTextAttachments, textAttachmentLabel } from './text-attachments.js';

function fileKey(file) {
  return [file.name, file.size, file.lastModified].join(':');
}

export function setupAttachmentManager({
  documentImpl = document,
  windowImpl = window,
  textarea,
  fileInput,
  attachButton,
  attachmentList,
  updateSendEnabled = () => {},
} = {}) {
  const objectUrls = new WeakMap();
  let selectedFiles = [];
  let selectedTextAttachments = [];

  function getAttachmentObjectUrl(file) {
    if (!file.type || !file.type.startsWith('image/')) return '';
    const urlApi = windowImpl.URL || windowImpl.webkitURL;
    if (!urlApi || typeof urlApi.createObjectURL !== 'function') return '';
    let url = objectUrls.get(file);
    if (!url) {
      url = urlApi.createObjectURL(file);
      objectUrls.set(file, url);
    }
    return url;
  }

  function revokeAttachmentObjectUrl(file) {
    const url = objectUrls.get(file);
    const urlApi = windowImpl.URL || windowImpl.webkitURL;
    if (url && urlApi && typeof urlApi.revokeObjectURL === 'function') {
      urlApi.revokeObjectURL(url);
    }
    objectUrls.delete(file);
  }

  function clearFiles() {
    selectedFiles.forEach(revokeAttachmentObjectUrl);
    selectedFiles = [];
  }

  const textAttachmentViewer = setupTextAttachmentViewer({ documentImpl });
  const openTextAttachment = textAttachmentViewer.open;

  function render() {
    if (!attachmentList) {
      updateSendEnabled();
      return;
    }
    const fragment = documentImpl.createDocumentFragment();
    selectedFiles.forEach((file, index) => {
      const item = documentImpl.createElement('span');
      const previewUrl = getAttachmentObjectUrl(file);
      item.className = 'pi-chat-attachment' + (previewUrl ? ' image-only' : '');

      if (previewUrl) {
        const preview = documentImpl.createElement('img');
        preview.className = 'pi-chat-attachment-preview';
        preview.src = previewUrl;
        preview.alt = '';
        preview.loading = 'lazy';
        preview.decoding = 'async';
        item.appendChild(preview);
      } else {
        const name = documentImpl.createElement('span');
        name.className = 'pi-chat-attachment-name';
        name.textContent = file.name;
        item.appendChild(name);
      }

      const remove = documentImpl.createElement('button');
      remove.type = 'button';
      remove.className = 'pi-chat-remove';
      remove.setAttribute('aria-label', 'Remove ' + file.name);
      remove.innerHTML = icon(X, { size: 13 });
      remove.addEventListener('click', () => {
        const [removed] = selectedFiles.splice(index, 1);
        if (removed) revokeAttachmentObjectUrl(removed);
        render();
      });
      item.appendChild(remove);
      fragment.appendChild(item);
    });

    selectedTextAttachments.forEach((att, index) => {
      const item = documentImpl.createElement('span');
      item.className = 'pi-chat-attachment pi-chat-attachment-text';
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.title = t('composer.viewAttachment');

      const name = documentImpl.createElement('span');
      name.className = 'pi-chat-attachment-name';
      name.innerHTML = icon(TextQuote, { size: 12 });
      const label = documentImpl.createElement('span');
      label.textContent = textAttachmentLabel(att, t('composer.attachmentText'));
      name.appendChild(label);
      item.appendChild(name);

      const remove = documentImpl.createElement('button');
      remove.type = 'button';
      remove.className = 'pi-chat-remove';
      remove.setAttribute('aria-label', t('composer.removeAttachment'));
      remove.innerHTML = icon(X, { size: 13 });
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedTextAttachments.splice(index, 1);
        render();
      });
      item.appendChild(remove);

      item.addEventListener('click', (event) => {
        if (event.target.closest('.pi-chat-remove')) return;
        openTextAttachment(att);
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openTextAttachment(att);
        }
      });
      fragment.appendChild(item);
    });

    attachmentList.replaceChildren(fragment);
    updateSendEnabled();
  }

  function addFiles(files = []) {
    const seen = new Set(selectedFiles.map(fileKey));
    let added = false;
    for (const file of files) {
      if (!seen.has(fileKey(file))) {
        selectedFiles.push(file);
        seen.add(fileKey(file));
        added = true;
      }
    }
    if (added) render();
    return added;
  }

  attachButton?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    addFiles(fileInput.files || []);
    fileInput.value = '';
  });

  textarea?.addEventListener('paste', (event) => {
    const data = event.clipboardData;
    if (!data) return;
    const imageFiles = [];

    if (data.items) {
      for (const item of data.items) {
        if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
    }

    let added = addFiles(imageFiles);
    if (!added && data.files) {
      const fallbackFiles = [];
      for (const file of data.files) {
        if (file.type && file.type.startsWith('image/')) fallbackFiles.push(file);
      }
      added = addFiles(fallbackFiles);
    }

    if (added) {
      const pastedText = data.getData?.('text/plain') || '';
      if (!pastedText) {
        event.preventDefault();
      }
      textarea.focus();
    }
  });

  const onAttachText = (event) => {
    const detail = (event && event.detail) || {};
    const original = String(detail.original || '').trim();
    if (!original) return;
    selectedTextAttachments.push({
      id: 'txt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      original,
      note: String(detail.note || '').trim(),
    });
    render();
    if (textarea && typeof textarea.focus === 'function') textarea.focus();
  };
  windowImpl.addEventListener('pi-chat-attach-text', onAttachText);

  return {
    dispose: () => windowImpl.removeEventListener('pi-chat-attach-text', onAttachText),
    files: () => selectedFiles,
    textAttachments: () => selectedTextAttachments,
    hasAttachments: () => selectedFiles.length > 0 || selectedTextAttachments.length > 0,
    composeMessage: (typed) => composeMessageWithTextAttachments(typed, selectedTextAttachments),
    clear: () => {
      clearFiles();
      selectedTextAttachments = [];
      if (fileInput) fileInput.value = '';
      render();
    },
    restore: ({ files = [], textAttachments = [] } = {}) => {
      clearFiles();
      selectedFiles = files.slice();
      selectedTextAttachments = textAttachments.slice();
      render();
    },
    render,
  };
}
