const DATABASE_NAME = 'ingallery-background-uploads';
const JOBS_STORE = 'jobs';
const FILES_STORE = 'files';
const runningJobs = new Set();
const MAX_CONCURRENT_PHOTO_UPLOADS = 4;

const openDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.addEventListener('upgradeneeded', () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(JOBS_STORE)) database.createObjectStore(JOBS_STORE, { keyPath: 'id' });
    if (!database.objectStoreNames.contains(FILES_STORE)) database.createObjectStore(FILES_STORE, { keyPath: 'id' });
  });
  request.addEventListener('success', () => resolve(request.result));
  request.addEventListener('error', () => reject(request.error));
});

const writeStores = async (stores, action) => {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, 'readwrite');
    action(transaction);
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
  });
  database.close();
};

const readValue = async (storeName, key) => {
  const database = await openDatabase();
  const value = await new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
  database.close();
  return value;
};

const readStoredFile = async (id) => (await readValue(FILES_STORE, id))?.file;

const normalizeUploadRecord = (record = {}) => ({
  id: record.id ?? null,
  storagePath: record.storagePath ?? record.storage_path ?? null,
  fileName: record.fileName ?? record.file_name ?? null,
  mimeType: record.mimeType ?? record.mime_type ?? null,
  fileSize: record.fileSize ?? record.file_size ?? 0,
  createdAt: record.createdAt ?? record.created_at ?? null
});

const getSupportedImageMimeType = (file) => {
  const mimeType = String(file.type || '').trim().toLowerCase();
  if (mimeType === 'image/jpg') return 'image/jpeg';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) return mimeType;
  if (['video/mp4', 'video/webm'].includes(mimeType)) return mimeType;
  if (mimeType) return null;
  const extension = String(file.name || '').split('.').pop()?.toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' })[extension] ?? null;
};

const getSupportedGalleryMediaMimeType = (file) => {
  const mimeType = getSupportedImageMimeType(file);
  return mimeType && (mimeType.startsWith('image/') || ['video/mp4', 'video/webm'].includes(mimeType)) ? mimeType : null;
};

const readJobs = async () => {
  const database = await openDatabase();
  const jobs = await new Promise((resolve, reject) => {
    const transaction = database.transaction(JOBS_STORE, 'readonly');
    const request = transaction.objectStore(JOBS_STORE).getAll();
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
  database.close();
  return jobs;
};

const saveJob = async (job) => writeStores([JOBS_STORE], (transaction) => {
  transaction.objectStore(JOBS_STORE).put(job);
});

const deleteStoredFile = async (id) => writeStores([FILES_STORE], (transaction) => {
  transaction.objectStore(FILES_STORE).delete(id);
});

const publicJob = (job) => {
  const totalItems = job.photoCount + (job.hasCover ? 1 : 0);
  const completedItems = job.uploadedPhotos + (job.coverSet ? 1 : 0);
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    stage: job.stage,
    photoCount: job.photoCount,
    stagedPhotos: job.stagedPhotos,
    uploadedPhotos: job.uploadedPhotos,
    hasCover: job.hasCover,
    totalItems,
    completedItems,
    percent: job.status === 'staging'
      ? Math.round(((job.stagedPhotos || 0) / Math.max(1, job.photoCount)) * 10)
      : totalItems ? Math.round((completedItems / totalItems) * 100) : 100,
    currentFile: job.currentFile,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    dismissed: job.dismissed
  };
};

const broadcastJob = async (job) => {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const message = { type: 'INGALLERY_UPLOAD_UPDATE', job: publicJob(job) };
  tabs.forEach((tab) => tab.postMessage(message));
};

const updateJob = async (job, changes) => {
  Object.assign(job, changes);
  await saveJob(job);
  await broadcastJob(job);
};

const cancelUploadReservation = async (job, headers, storagePath) => {
  await fetch(`${job.apiBaseUrl}/api/galleries/${encodeURIComponent(job.galleryId)}/upload-cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ storagePath })
  }).catch(() => {});
};

const getAuthorizedUpload = async (job, file) => {
  const mimeType = getSupportedGalleryMediaMimeType(file);
  if (!mimeType) throw new Error(`${file.name || 'Selected file'} is not a supported JPG, PNG, WEBP, MP4, or WebM file.`);
  const headers = {
    Authorization: `Bearer ${job.accessToken}`,
    'Content-Type': 'application/json'
  };
  const uploadUrlResponse = await fetch(`${job.apiBaseUrl}/api/galleries/${encodeURIComponent(job.galleryId)}/upload-url`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileName: file.name, mimeType, fileSize: file.size })
  });
  const uploadDetails = await uploadUrlResponse.json().catch(() => null);
  if (!uploadUrlResponse.ok || !uploadDetails?.ok) {
    const error = new Error(uploadDetails?.message || 'Unable to reserve storage for this media file.');
    error.name = 'StorageQuotaError';
    throw error;
  }

  const upload = uploadDetails.data;
  let storageResponse;
  try {
    storageResponse = await fetch(upload.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: file
    });
  } catch {
    await cancelUploadReservation(job, headers, upload.storagePath);
    throw new Error('Media upload to storage failed. Retry to continue.');
  }
  if (!storageResponse.ok) {
    await cancelUploadReservation(job, headers, upload.storagePath);
    throw new Error('Media upload to storage failed. Retry to continue.');
  }

  const confirmationResponse = await fetch(`${job.apiBaseUrl}/api/galleries/${encodeURIComponent(job.galleryId)}/images`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      storagePath: upload.storagePath,
      fileName: file.name,
      mimeType,
      fileSize: file.size
    })
  });
  const confirmation = await confirmationResponse.json().catch(() => null);
  if (!confirmationResponse.ok || !confirmation?.ok) {
    await cancelUploadReservation(job, headers, upload.storagePath);
    throw new Error(confirmation?.message || 'Media metadata could not be saved. Retry to continue.');
  }
  return normalizeUploadRecord(confirmation.data);
};

const processJob = async (jobId) => {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  try {
    const job = await readValue(JOBS_STORE, jobId);
    if (!job || job.dismissed || job.status === 'complete') return;

    await updateJob(job, { status: 'uploading', errorMessage: null });

    if (job.hasCover && !job.coverSet) {
      await updateJob(job, { stage: 'cover', currentFile: job.coverName });
      const coverFile = await readStoredFile(`${job.id}:cover`);
      if (!coverFile) throw new Error('The selected cover file is unavailable');
      const coverMimeType = getSupportedImageMimeType(coverFile);
      if (!coverMimeType) throw new Error(`${coverFile.name || 'Selected cover'} is not a supported JPG, PNG, or WEBP image.`);
      if (!job.coverUpload?.storagePath) {
        const coverUpload = await getAuthorizedUpload(job, coverFile);
        job.coverUpload = { storagePath: coverUpload.storagePath, mimeType: coverMimeType };
      }
      job.coverUpload.mimeType = coverMimeType;
      await saveJob(job);

      const coverResponse = await fetch(`${job.apiBaseUrl}/api/galleries/${encodeURIComponent(job.galleryId)}/cover`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${job.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(job.coverUpload)
      });
      const coverResult = await coverResponse.json();
      if (!coverResponse.ok || !coverResult.ok) throw new Error(coverResult.message || 'Cover upload failed');
      job.coverSet = true;
      await deleteStoredFile(`${job.id}:cover`);
      await updateJob(job, { stage: 'photos', currentFile: '' });
    }

    const uploadedPhotoIndexes = new Set(Array.isArray(job.uploadedPhotoIndexes)
      ? job.uploadedPhotoIndexes
      : Array.from({ length: Math.min(Number(job.uploadedPhotos) || 0, job.photoCount) }, (_, index) => index));
    job.uploadedPhotoIndexes = Array.from(uploadedPhotoIndexes);
    job.uploadedPhotos = uploadedPhotoIndexes.size;
    const pendingPhotoIndexes = Array.from({ length: job.photoCount }, (_, index) => index)
      .filter((index) => !uploadedPhotoIndexes.has(index));
    let nextPhotoPosition = 0;
    let firstUploadError = null;
    const uploadNextPhoto = async () => {
      while (!firstUploadError) {
        const photoPosition = nextPhotoPosition++;
        if (photoPosition >= pendingPhotoIndexes.length) return;
        const index = pendingPhotoIndexes[photoPosition];
        try {
          const photo = await readStoredFile(`${job.id}:photo:${index}`);
          if (!photo) throw new Error('A selected photo is unavailable');
          await updateJob(job, {
            stage: 'photo',
            currentFile: 'photos'
          });
          await getAuthorizedUpload(job, photo);

          uploadedPhotoIndexes.add(index);
          job.uploadedPhotoIndexes = Array.from(uploadedPhotoIndexes).sort((left, right) => left - right);
          job.uploadedPhotos = uploadedPhotoIndexes.size;
          await updateJob(job, {
            stage: 'photo',
            uploadedPhotos: job.uploadedPhotos,
            uploadedPhotoIndexes: job.uploadedPhotoIndexes,
            currentFile: 'photos'
          });
          await deleteStoredFile(`${job.id}:photo:${index}`).catch(() => {});
        } catch (error) {
          firstUploadError ??= error;
        }
      }
    };
    const workerCount = Math.min(MAX_CONCURRENT_PHOTO_UPLOADS, pendingPhotoIndexes.length);
    await Promise.all(Array.from({ length: workerCount }, () => uploadNextPhoto()));
    if (firstUploadError) throw firstUploadError;

    await updateJob(job, {
      status: 'complete',
      stage: 'complete',
      currentFile: '',
      accessToken: null
    });
  } catch (error) {
    const job = await readValue(JOBS_STORE, jobId);
    if (job) {
      console.error('gallery_background_upload_failed', error);
      await updateJob(job, {
        status: 'failed',
        errorMessage: error instanceof Error
          ? error.message
          : String(error || 'Upload failed for an unknown reason.'),
        accessToken: job.accessToken
      });
    }
  } finally {
    runningJobs.delete(jobId);
  }
};

const resumeJobs = async () => {
  const jobs = await readJobs();
  for (const job of jobs) {
    if (job.status === 'queued' || job.status === 'uploading') await processJob(job.id);
  }
};

const replyToMessage = (event, result) => event.ports[0]?.postMessage(result);

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'START_GALLERY_UPLOAD') {
    event.waitUntil((async () => {
      try {
        const incoming = message.job;
        const job = {
          id: incoming.id,
          galleryId: incoming.galleryId,
          slug: incoming.slug,
          title: incoming.title,
          apiBaseUrl: incoming.apiBaseUrl,
          accessToken: incoming.accessToken,
          photoCount: incoming.photoCount,
          stagedPhotos: 0,
          uploadedPhotos: 0,
          uploadedPhotoIndexes: [],
          hasCover: incoming.hasCover,
          coverName: incoming.coverName,
          coverStaged: !incoming.hasCover,
          coverUpload: null,
          coverSet: false,
          status: 'staging',
          stage: 'staging',
          currentFile: '',
          errorMessage: null,
          createdAt: Date.now(),
          dismissed: false
        };
        await saveJob(job);
        await broadcastJob(job);
        replyToMessage(event, { ok: true });
      } catch (error) {
        console.error('gallery_background_queue_failed', error);
        replyToMessage(event, { ok: false, message: 'Could not create the upload queue.' });
      }
    })());
  } else if (message.type === 'ADD_GALLERY_UPLOAD_FILES') {
    event.waitUntil((async () => {
      try {
        const job = await readValue(JOBS_STORE, message.jobId);
        if (!job || job.status !== 'staging' || Number(message.startIndex) !== job.stagedPhotos) {
          throw new Error('The upload queue is out of sync.');
        }
        const files = message.files || [];
        await writeStores([FILES_STORE], (transaction) => {
          const store = transaction.objectStore(FILES_STORE);
          files.forEach((file, index) => store.put({ id: `${job.id}:photo:${job.stagedPhotos + index}`, file }));
          if (message.coverFile && !job.coverStaged) store.put({ id: `${job.id}:cover`, file: message.coverFile });
        });
        job.stagedPhotos += files.length;
        if (message.coverFile) job.coverStaged = true;
        await updateJob(job, { stagedPhotos: job.stagedPhotos, coverStaged: job.coverStaged });
        replyToMessage(event, { ok: true, stagedPhotos: job.stagedPhotos });
      } catch (error) {
        console.error('gallery_background_files_stage_failed', error);
        const messageText = error?.name === 'QuotaExceededError'
          ? 'Your browser does not have enough local storage to queue all selected media files. Try fewer files at a time.'
          : error instanceof Error ? error.message : 'Could not save the selected media files.';
        replyToMessage(event, { ok: false, message: messageText });
      }
    })());
  } else if (message.type === 'QUEUE_GALLERY_UPLOAD') {
    event.waitUntil((async () => {
      const job = await readValue(JOBS_STORE, message.jobId);
      if (!job || job.stagedPhotos !== job.photoCount || !job.coverStaged) {
        replyToMessage(event, { ok: false, message: 'Not all selected media files were saved to the upload queue.' });
        return;
      }
      await updateJob(job, { status: 'queued', stage: 'queued' });
      replyToMessage(event, { ok: true });
      await processJob(job.id);
    })());
  } else if (message.type === 'CANCEL_GALLERY_UPLOAD_STAGING') {
    event.waitUntil((async () => {
      const job = await readValue(JOBS_STORE, message.jobId);
      if (!job || job.status !== 'staging') {
        replyToMessage(event, { ok: false, message: 'Upload staging is no longer cancellable.' });
        return;
      }
      for (let index = 0; index < job.stagedPhotos; index += 1) await deleteStoredFile(`${job.id}:photo:${index}`);
      if (job.hasCover && job.coverStaged) await deleteStoredFile(`${job.id}:cover`);
      await updateJob(job, { status: 'failed', dismissed: true, errorMessage: 'Upload queue was cancelled.' });
      replyToMessage(event, { ok: true });
    })());
  } else if (message.type === 'GET_GALLERY_UPLOADS') {
    event.waitUntil((async () => {
      const jobs = (await readJobs()).map(publicJob);
      event.source?.postMessage({ type: 'INGALLERY_UPLOAD_LIST', jobs });
    })());
  } else if (message.type === 'RESUME_GALLERY_UPLOADS') {
    event.waitUntil(resumeJobs());
  } else if (message.type === 'RETRY_GALLERY_UPLOAD') {
    event.waitUntil((async () => {
      const job = await readValue(JOBS_STORE, message.jobId);
      if (!job) return;
      await updateJob(job, { status: 'queued', stage: 'queued', errorMessage: null });
      await processJob(job.id);
    })());
  } else if (message.type === 'DISMISS_GALLERY_UPLOAD') {
    event.waitUntil((async () => {
      const job = await readValue(JOBS_STORE, message.jobId);
      if (!job || (job.status !== 'complete' && job.status !== 'failed')) return;
      await updateJob(job, { dismissed: true });
    })());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'ingallery-gallery-uploads') event.waitUntil(resumeJobs());
});
