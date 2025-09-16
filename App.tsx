/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import JSZip from 'jszip';
import { generateEditedImage, generateFilteredImage, generateAdjustedImage, generateUpscaledImage } from './services/geminiService';
import Header from './components/Header';
import Spinner from './components/Spinner';
import FilterPanel from './components/FilterPanel';
import AdjustmentPanel from './components/AdjustmentPanel';
import CropPanel from './components/CropPanel';
import { UndoIcon, RedoIcon, EyeIcon, CloseIcon } from './components/icons';
import StartScreen from './components/StartScreen';

// Helper to convert a data URL string to a File object
const dataURLtoFile = (dataurl: string, filename: string): File => {
    const arr = dataurl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");

    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, {type:mime});
}

type Tab = 'retouch' | 'adjust' | 'filters' | 'crop';

interface ImageState {
  id: string;
  name: string;
  originalFile: File;
  history: File[];
  historyIndex: number;
}

const App: React.FC = () => {
  const [images, setImages] = useState<ImageState[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  
  const [prompt, setPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState('AI sedang bekerja...');
  const [error, setError] = useState<string | null>(null);
  const [editHotspot, setEditHotspot] = useState<{ x: number, y: number } | null>(null);
  const [displayHotspot, setDisplayHotspot] = useState<{ x: number, y: number } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('retouch');
  
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [aspect, setAspect] = useState<number | undefined>();
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const [previewImage, setPreviewImage] = useState<File | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [isComparingPreview, setIsComparingPreview] = useState<boolean>(false);
  const [downloadResolution, setDownloadResolution] = useState<string>('original');

  const activeImageState = images.find(img => img.id === activeImageId);
  const currentImage = activeImageState?.history[activeImageState.historyIndex] ?? null;
  const originalImage = activeImageState?.originalFile ?? null;
  const isPreviewing = !!previewImage;

  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (previewImage) {
      const url = URL.createObjectURL(previewImage);
      setPreviewImageUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPreviewImageUrl(null);
    }
  }, [previewImage]);

  useEffect(() => {
    if (currentImage) {
      const url = URL.createObjectURL(currentImage);
      setCurrentImageUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setCurrentImageUrl(null);
    }
  }, [currentImage]);
  
  useEffect(() => {
    if (originalImage) {
      const url = URL.createObjectURL(originalImage);
      setOriginalImageUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setOriginalImageUrl(null);
    }
  }, [originalImage]);

  useEffect(() => {
    const urls: Record<string, string> = {};
    images.forEach(image => {
      urls[image.id] = URL.createObjectURL(image.history[image.historyIndex]);
    });
    setThumbnailUrls(urls);

    return () => {
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [images]);

  useEffect(() => {
    if (selectedImageIds.size > 1 && (activeTab === 'retouch' || activeTab === 'crop')) {
        setActiveTab('adjust');
    }
  }, [selectedImageIds, activeTab]);

  const canUndo = (activeImageState?.historyIndex ?? 0) > 0;
  const canRedo = activeImageState ? activeImageState.historyIndex < activeImageState.history.length - 1 : false;

  const addImageToHistory = useCallback((newImageFile: File, imageId: string) => {
    setImages(currentImages =>
      currentImages.map(image => {
        if (image.id === imageId) {
          const newHistory = image.history.slice(0, image.historyIndex + 1);
          newHistory.push(newImageFile);
          return {
            ...image,
            history: newHistory,
            historyIndex: newHistory.length - 1,
          };
        }
        return image;
      })
    );
    if (imageId === activeImageId) {
        setCrop(undefined);
        setCompletedCrop(undefined);
    }
  }, [activeImageId]);

  const handleImageUploads = useCallback((files: FileList) => {
    setError(null);
    const newImages: ImageState[] = Array.from(files).map(file => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      name: file.name,
      originalFile: file,
      history: [file],
      historyIndex: 0,
    }));

    setImages(currentImages => [...currentImages, ...newImages]);
    const firstNewImageId = newImages[0]?.id;
    if (firstNewImageId) {
        if (!activeImageId) {
            setActiveImageId(firstNewImageId);
        }
        setSelectedImageIds(currentIds => new Set([...currentIds, firstNewImageId]));
    }
    
    setEditHotspot(null);
    setDisplayHotspot(null);
    setActiveTab('retouch');
    setCrop(undefined);
    setCompletedCrop(undefined);
  }, [activeImageId]);

  const handleDeleteImage = useCallback((idToDelete: string) => {
    setImages(currentImages => {
      const newImages = currentImages.filter(img => img.id !== idToDelete);
      if (activeImageId === idToDelete) {
        setActiveImageId(newImages[0]?.id ?? null);
      }
      return newImages;
    });
    setSelectedImageIds(currentIds => {
        const newIds = new Set(currentIds);
        newIds.delete(idToDelete);
        return newIds;
    });
  }, [activeImageId]);

  const handleGenerate = useCallback(async () => {
    if (!currentImage || !activeImageId) {
      setError('Tidak ada gambar yang dimuat untuk diedit.');
      return;
    }
    if (!prompt.trim()) {
        setError('Silakan masukkan deskripsi untuk editan Anda.');
        return;
    }
    if (!editHotspot) {
        setError('Silakan klik pada gambar untuk memilih area yang akan diedit.');
        return;
    }

    setIsLoading(true);
    setLoadingMessage('AI sedang bekerja...');
    setError(null);
    
    try {
        const editedImageUrl = await generateEditedImage(currentImage, prompt, editHotspot);
        const newImageFile = dataURLtoFile(editedImageUrl, `edited-${Date.now()}.png`);
        setPreviewImage(newImageFile);
        setEditHotspot(null);
        setDisplayHotspot(null);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Terjadi kesalahan tidak dikenal.';
        setError(`Gagal membuat gambar. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
    }
  }, [currentImage, prompt, editHotspot, activeImageId]);
  
  const handleBatchOperation = async (
    operation: (file: File, prompt: string) => Promise<string>,
    prompt: string,
    operationName: string
  ) => {
    const targets = images.filter(img => selectedImageIds.has(img.id));
    if (targets.length === 0) {
      setError(`Pilih setidaknya satu gambar untuk menerapkan ${operationName}.`);
      return;
    }
    
    setIsLoading(true);
    setLoadingMessage('AI sedang bekerja...');
    setError(null);

    if (targets.length === 1) {
        try {
            const target = targets[0];
            const resultUrl = await operation(target.history[target.historyIndex], prompt);
            const newImageFile = dataURLtoFile(resultUrl, `${operationName}-${target.name}`);
            setPreviewImage(newImageFile);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Terjadi kesalahan tidak dikenal.';
            setError(`Gagal menerapkan ${operationName}. ${errorMessage}`);
        } finally {
            setIsLoading(false);
        }
        return;
    }
  
    const results = await Promise.allSettled(
      targets.map(target =>
        operation(target.history[target.historyIndex], prompt)
      )
    );
  
    const newImageFiles = new Map<string, File>();
    const failedEdits: string[] = [];
  
    results.forEach((result, index) => {
      const targetImage = targets[index];
      if (result.status === 'fulfilled') {
        const newImageFile = dataURLtoFile(result.value, `${operationName}-${targetImage.name}`);
        newImageFiles.set(targetImage.id, newImageFile);
      } else {
        console.error(`Gagal menerapkan ${operationName} pada ${targetImage.name}:`, result.reason);
        failedEdits.push(targetImage.name);
      }
    });
  
    if (newImageFiles.size > 0) {
        setImages(currentImages =>
            currentImages.map(image => {
                if (newImageFiles.has(image.id)) {
                    const newImageFile = newImageFiles.get(image.id)!;
                    const newHistory = image.history.slice(0, image.historyIndex + 1);
                    newHistory.push(newImageFile);
                    return { ...image, history: newHistory, historyIndex: newHistory.length - 1 };
                }
                return image;
            })
        );
    }
  
    if (failedEdits.length > 0) {
      setError(`Gagal menerapkan ${operationName} pada ${failedEdits.length} gambar: ${failedEdits.join(', ')}. Gambar lainnya berhasil diperbarui.`);
    }
  
    setIsLoading(false);
  };

  const handleApplyFilter = (filterPrompt: string) => {
    handleBatchOperation(generateFilteredImage, filterPrompt, "filter");
  };

  const handleApplyAdjustment = (adjustmentPrompt: string) => {
    handleBatchOperation(generateAdjustedImage, adjustmentPrompt, "penyesuaian");
  };

  const handleApplyCrop = useCallback(() => {
    if (!completedCrop || !imgRef.current || !activeImageId) {
        setError('Silakan pilih area untuk dipotong.');
        return;
    }
    const image = imgRef.current;
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width = completedCrop.width;
    canvas.height = completedCrop.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        setError('Tidak dapat memproses pemotongan.');
        return;
    }
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = completedCrop.width * pixelRatio;
    canvas.height = completedCrop.height * pixelRatio;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0, 0, completedCrop.width, completedCrop.height
    );
    const croppedImageUrl = canvas.toDataURL('image/png');
    const newImageFile = dataURLtoFile(croppedImageUrl, `cropped-${Date.now()}.png`);
    addImageToHistory(newImageFile, activeImageId);
  }, [completedCrop, addImageToHistory, activeImageId]);

  const handleUndo = useCallback(() => {
    if (canUndo && activeImageId) {
        setImages(currentImages => currentImages.map(img =>
            img.id === activeImageId ? { ...img, historyIndex: img.historyIndex - 1 } : img
        ));
        setEditHotspot(null);
        setDisplayHotspot(null);
    }
  }, [canUndo, activeImageId]);
  
  const handleRedo = useCallback(() => {
    if (canRedo && activeImageId) {
        setImages(currentImages => currentImages.map(img =>
            img.id === activeImageId ? { ...img, historyIndex: img.historyIndex + 1 } : img
        ));
        setEditHotspot(null);
        setDisplayHotspot(null);
    }
  }, [canRedo, activeImageId]);

  const handleReset = useCallback(() => {
    setImages(currentImages => currentImages.map(img =>
      img.id === activeImageId ? { ...img, history: [img.originalFile], historyIndex: 0 } : img
    ));
    setError(null);
    setEditHotspot(null);
    setDisplayHotspot(null);
  }, [activeImageId]);

  const handleUploadNew = useCallback(() => {
      setImages([]);
      setActiveImageId(null);
      setSelectedImageIds(new Set());
      setError(null);
      setPrompt('');
      setEditHotspot(null);
      setDisplayHotspot(null);
  }, []);

  const handleDownload = useCallback(async () => {
    const imagesToDownload = images.filter(img => selectedImageIds.has(img.id));
    if (imagesToDownload.length === 0) return;

    setIsLoading(true);
    setError(null);

    const downloadFile = (file: File, name: string) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(file);
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    };
    
    try {
        if (downloadResolution === 'original') {
            if (imagesToDownload.length === 1) {
                const imageState = imagesToDownload[0];
                const imageFile = imageState.history[imageState.historyIndex];
                downloadFile(imageFile, `edited-${imageState.name}`);
            } else {
                const zip = new JSZip();
                for (const imageState of imagesToDownload) {
                    const currentVersionOfImage = imageState.history[imageState.historyIndex];
                    zip.file(`edited-${imageState.name}`, currentVersionOfImage);
                }
                const content = await zip.generateAsync({ type: "blob" });
                downloadFile(new File([content], "rafurii-edits.zip", { type: "application/zip" }), "rafurii-edits.zip");
            }
        } else {
            setLoadingMessage('Meningkatkan resolusi... Ini mungkin memakan waktu.');
            if (imagesToDownload.length === 1) {
                const imageState = imagesToDownload[0];
                const imageFile = imageState.history[imageState.historyIndex];
                const upscaledUrl = await generateUpscaledImage(imageFile, downloadResolution);
                const upscaledFile = dataURLtoFile(upscaledUrl, `upscaled-${imageState.name}`);
                downloadFile(upscaledFile, `upscaled-4k-${imageState.name}`);
            } else {
                 const zip = new JSZip();
                 await Promise.all(imagesToDownload.map(async (imageState) => {
                    const imageFile = imageState.history[imageState.historyIndex];
                    const upscaledUrl = await generateUpscaledImage(imageFile, downloadResolution);
                    const upscaledFile = dataURLtoFile(upscaledUrl, `upscaled-${imageState.name}`);
                    zip.file(`upscaled-4k-${imageState.name}`, upscaledFile);
                 }));
                 const content = await zip.generateAsync({type: 'blob'});
                 downloadFile(new File([content], "rafurii-upscaled-edits.zip", {type: "application/zip"}), "rafurii-upscaled-edits.zip");
            }
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Terjadi kesalahan tidak dikenal.';
        setError(`Gagal mengunduh file. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
    }
  }, [images, selectedImageIds, downloadResolution]);

  const handleAcceptPreview = () => {
    if (previewImage && activeImageId) {
        addImageToHistory(previewImage, activeImageId);
    }
    setPreviewImage(null);
  };
  
  const handleCancelPreview = () => {
    setPreviewImage(null);
  };

  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      handleImageUploads(files);
    }
  };
  
  const handleSelectImage = (id: string) => {
    if (id === activeImageId) return;
    setActiveImageId(id);
    setEditHotspot(null);
    setDisplayHotspot(null);
    setActiveTab('retouch');
    setCrop(undefined);
    setCompletedCrop(undefined);
    setError(null);
  };
  
  const handleToggleSelection = (id: string) => {
    setSelectedImageIds(currentIds => {
      const newIds = new Set(currentIds);
      if (newIds.has(id)) {
        newIds.delete(id);
      } else {
        newIds.add(id);
      }
      return newIds;
    });
  };

  const handleSelectAll = () => {
    setSelectedImageIds(new Set(images.map(img => img.id)));
  };

  const handleDeselectAll = () => {
    setSelectedImageIds(new Set());
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (activeTab !== 'retouch' || isPreviewing) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    setDisplayHotspot({ x: offsetX, y: offsetY });
    const { naturalWidth, naturalHeight, clientWidth, clientHeight } = img;
    const scaleX = naturalWidth / clientWidth;
    const scaleY = naturalHeight / clientHeight;
    const originalX = Math.round(offsetX * scaleX);
    const originalY = Math.round(offsetY * scaleY);
    setEditHotspot({ x: originalX, y: originalY });
  };

  const renderContent = () => {
    if (error) {
       return (
           <div className="text-center animate-fade-in bg-red-500/10 border border-red-500/20 p-8 rounded-lg max-w-2xl mx-auto flex flex-col items-center gap-4">
            <h2 className="text-2xl font-bold text-red-300">Terjadi Kesalahan</h2>
            <p className="text-md text-red-400">{error}</p>
            <button
                onClick={() => setError(null)}
                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg text-md transition-colors"
              >
                Coba Lagi
            </button>
          </div>
        );
    }
    
    if (images.length === 0) {
      return <StartScreen onFileSelect={handleFileSelect} />;
    }

    const showOriginalForCompare = isComparing && !isPreviewing;

    const imageDisplay = (
        <div className="relative">
            {originalImageUrl && (
                <img
                    key={originalImageUrl}
                    src={originalImageUrl}
                    alt="Original"
                    className="w-full h-auto object-contain max-h-[60vh] rounded-xl pointer-events-none"
                />
            )}
            {currentImageUrl && <img
                ref={imgRef}
                key={currentImageUrl}
                src={isComparingPreview ? currentImageUrl : (previewImageUrl || currentImageUrl)}
                alt="Current"
                onClick={handleImageClick}
                className={`absolute top-0 left-0 w-full h-auto object-contain max-h-[60vh] rounded-xl transition-opacity duration-200 ease-in-out ${showOriginalForCompare ? 'opacity-0' : 'opacity-100'} ${activeTab === 'retouch' && !isPreviewing ? 'cursor-crosshair' : ''}`}
            />}
        </div>
    );
    
    return (
      <div className="w-full max-w-4xl mx-auto flex flex-col items-center gap-6 animate-fade-in">
        <div className="relative w-full shadow-2xl rounded-xl overflow-hidden bg-black/20">
            {isLoading && (
                <div className="absolute inset-0 bg-black/70 z-30 flex flex-col items-center justify-center gap-4 animate-fade-in">
                    <Spinner />
                    <p className="text-gray-300">{loadingMessage}</p>
                </div>
            )}
            
            {activeTab === 'crop' ? (
              <ReactCrop 
                crop={crop} 
                onChange={c => setCrop(c)} 
                onComplete={c => setCompletedCrop(c)}
                aspect={aspect}
                className="max-h-[60vh]"
                disabled={isPreviewing}
              >
                <img 
                    ref={imgRef}
                    key={`crop-${currentImageUrl}`}
                    src={currentImageUrl ?? undefined} 
                    alt="Crop this image"
                    className="w-full h-auto object-contain max-h-[60vh] rounded-xl"
                />
              </ReactCrop>
            ) : imageDisplay }

            {previewImage && (
                <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-40">
                    <div className="bg-gray-900/70 backdrop-blur-md p-3 rounded-xl flex items-center gap-3 shadow-2xl border border-white/10 animate-fade-in">
                        <p className="font-semibold text-white mr-2">Pratinjau:</p>
                        <button
                            onMouseDown={() => setIsComparingPreview(true)}
                            onMouseUp={() => setIsComparingPreview(false)}
                            onMouseLeave={() => setIsComparingPreview(false)}
                            onTouchStart={() => setIsComparingPreview(true)}
                            onTouchEnd={() => setIsComparingPreview(false)}
                            className="flex items-center justify-center text-center bg-white/10 border border-white/20 text-gray-200 font-semibold py-2 px-4 rounded-md transition-all duration-200 ease-in-out hover:bg-white/20 active:scale-95 text-sm"
                        >
                            <EyeIcon className="w-4 h-4 mr-2" />
                            Bandingkan
                        </button>
                        <button
                            onClick={handleCancelPreview}
                            className="flex items-center justify-center text-center bg-red-600/80 border border-red-500/50 text-white font-semibold py-2 px-4 rounded-md transition-all duration-200 ease-in-out hover:bg-red-600 active:scale-95 text-sm"
                        >
                            Batalkan
                        </button>
                        <button
                            onClick={handleAcceptPreview}
                            className="flex items-center justify-center text-center bg-green-600/80 border border-green-500/50 text-white font-bold py-2 px-4 rounded-md transition-all duration-200 ease-in-out hover:bg-green-600 active:scale-95 text-sm"
                        >
                            Terapkan
                        </button>
                    </div>
                </div>
            )}

            {displayHotspot && !isLoading && activeTab === 'retouch' && !isPreviewing && (
                <div 
                    className="absolute rounded-full w-6 h-6 bg-blue-500/50 border-2 border-white pointer-events-none -translate-x-1/2 -translate-y-1/2 z-10"
                    style={{ left: `${displayHotspot.x}px`, top: `${displayHotspot.y}px` }}
                >
                    <div className="absolute inset-0 rounded-full w-6 h-6 animate-ping bg-blue-400"></div>
                </div>
            )}
        </div>
        
        {images.length > 0 && (
            <div className={`w-full bg-gray-900/50 p-2 rounded-lg backdrop-blur-sm flex flex-col gap-2 transition-opacity ${isPreviewing ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="flex justify-end px-1">
                    {selectedImageIds.size === images.length ? (
                        <button onClick={handleDeselectAll} className="text-sm font-semibold text-blue-400 hover:text-blue-300">Batal Pilih Semua</button>
                    ) : (
                        <button onClick={handleSelectAll} className="text-sm font-semibold text-blue-400 hover:text-blue-300">Pilih Semua</button>
                    )}
                </div>
                <div className="flex items-center gap-3 overflow-x-auto py-1">
                {images.map(image => (
                  <div key={image.id} className="relative shrink-0 group">
                    <button
                      onClick={() => handleSelectImage(image.id)}
                      className={`w-24 h-24 rounded-md overflow-hidden transition-all duration-200 focus:outline-none ${
                          activeImageId === image.id ? 'ring-2 ring-offset-2 ring-offset-gray-800 ring-blue-500' : ''
                      }`}
                      aria-label={`Pilih gambar ${image.name}`}
                      >
                      <img
                          src={thumbnailUrls[image.id]}
                          alt={image.name}
                          className={`w-full h-full object-cover transition-opacity duration-200 ${activeImageId !== image.id ? 'opacity-60 group-hover:opacity-100' : ''}`}
                      />
                       <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate">{image.name}</div>
                    </button>
                    <div className="absolute top-1 left-1 z-10">
                        <input
                            type="checkbox"
                            checked={selectedImageIds.has(image.id)}
                            onChange={() => handleToggleSelection(image.id)}
                            className="w-5 h-5 bg-gray-700 border-gray-500 rounded text-blue-500 focus:ring-blue-600"
                            aria-label={`Pilih ${image.name}`}
                        />
                    </div>
                    <button
                      onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteImage(image.id);
                      }}
                      className="absolute -top-2 -right-2 z-10 p-1 bg-red-600 rounded-full text-white hover:bg-red-500 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-gray-900 opacity-0 group-hover:opacity-100"
                      aria-label={`Hapus gambar ${image.name}`}
                    >
                        <CloseIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                </div>
            </div>
        )}

        <div className={`w-full bg-gray-800/80 border border-gray-700/80 rounded-lg p-2 flex items-center justify-center gap-2 backdrop-blur-sm transition-opacity ${isPreviewing ? 'opacity-50 pointer-events-none' : ''}`}>
            {(['retouch', 'crop', 'adjust', 'filters'] as Tab[]).map(tab => {
                const tabNames = { retouch: 'Retouch', crop: 'Potong', adjust: 'Sesuaikan', filters: 'Filter' };
                const isMultiSelect = selectedImageIds.size > 1;
                const isDisabled = isMultiSelect && (tab === 'retouch' || tab === 'crop');
                return (
                 <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    disabled={isDisabled}
                    className={`w-full capitalize font-semibold py-3 px-5 rounded-md transition-all duration-200 text-base ${
                        activeTab === tab 
                        ? 'bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-lg shadow-cyan-500/40' 
                        : 'text-gray-300 hover:text-white hover:bg-white/10'
                    } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    {tabNames[tab]}
                </button>
            )})}
        </div>
        
        <div className={`w-full transition-opacity ${isPreviewing ? 'opacity-50 pointer-events-none' : ''}`}>
            {activeTab === 'retouch' && (
                <div className="flex flex-col items-center gap-4">
                    <p className="text-md text-gray-400">
                        {editHotspot ? 'Bagus! Sekarang deskripsikan editan Anda di bawah.' : 'Klik sebuah area di gambar untuk editan presisi.'}
                    </p>
                    <form onSubmit={(e) => { e.preventDefault(); handleGenerate(); }} className="w-full flex items-center gap-2">
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={editHotspot ? "contoh: 'ubah warna bajuku jadi biru'" : "Pertama, klik sebuah titik pada gambar"}
                            className="flex-grow bg-gray-800 border border-gray-700 text-gray-200 rounded-lg p-5 text-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition w-full disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isLoading || !editHotspot}
                        />
                        <button 
                            type="submit"
                            className="bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold py-5 px-8 text-lg rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-px active:scale-95 active:shadow-inner disabled:from-blue-800 disabled:to-blue-700 disabled:shadow-none disabled:cursor-not-allowed disabled:transform-none"
                            disabled={isLoading || !prompt.trim() || !editHotspot}
                        >
                            Buat
                        </button>
                    </form>
                </div>
            )}
            {activeTab === 'crop' && <CropPanel onApplyCrop={handleApplyCrop} onSetAspect={setAspect} isLoading={isLoading} isCropping={!!completedCrop?.width && completedCrop.width > 0} />}
            {activeTab === 'adjust' && <AdjustmentPanel onApplyAdjustment={handleApplyAdjustment} isLoading={isLoading} selectedImageCount={selectedImageIds.size} />}
            {activeTab === 'filters' && <FilterPanel onApplyFilter={handleApplyFilter} isLoading={isLoading} selectedImageCount={selectedImageIds.size} />}
        </div>
        
        <div className="w-full flex flex-wrap items-center justify-between gap-4 mt-6">
            <div className="flex flex-wrap items-center gap-3">
                <button 
                    onClick={handleUndo}
                    disabled={!canUndo || isPreviewing}
                    className="flex items-center justify-center text-center bg-white/10 border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/20 hover:border-white/30 active:scale-95 text-base disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/5"
                    aria-label="Urungkan aksi terakhir"
                >
                    <UndoIcon className="w-5 h-5 mr-2" />
                    Urungkan
                </button>
                <button 
                    onClick={handleRedo}
                    disabled={!canRedo || isPreviewing}
                    className="flex items-center justify-center text-center bg-white/10 border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/20 hover:border-white/30 active:scale-95 text-base disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/5"
                    aria-label="Ulangi aksi terakhir"
                >
                    <RedoIcon className="w-5 h-5 mr-2" />
                    Ulangi
                </button>
                
                <div className="h-6 w-px bg-gray-600 mx-1 hidden sm:block"></div>

                {canUndo && (
                  <button 
                      onMouseDown={() => setIsComparing(true)}
                      onMouseUp={() => setIsComparing(false)}
                      onMouseLeave={() => setIsComparing(false)}
                      onTouchStart={() => setIsComparing(true)}
                      onTouchEnd={() => setIsComparing(false)}
                      disabled={isPreviewing}
                      className="flex items-center justify-center text-center bg-white/10 border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/20 hover:border-white/30 active:scale-95 text-base disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Tekan dan tahan untuk melihat gambar asli"
                  >
                      <EyeIcon className="w-5 h-5 mr-2" />
                      Bandingkan
                  </button>
                )}

                <button 
                    onClick={handleReset}
                    disabled={!canUndo || isPreviewing}
                    className="text-center bg-transparent border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/10 hover:border-white/30 active:scale-95 text-base disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-transparent"
                  >
                    Reset
                </button>
                <button 
                    onClick={handleUploadNew}
                    disabled={isPreviewing}
                    className="text-center bg-white/10 border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/20 hover:border-white/30 active:scale-95 text-base disabled:opacity-50"
                >
                    Unggah Baru
                </button>
            </div>
            
            <div className="flex items-stretch gap-2">
                <select 
                    value={downloadResolution} 
                    onChange={(e) => setDownloadResolution(e.target.value)}
                    disabled={selectedImageIds.size === 0 || isLoading || isPreviewing}
                    className="bg-gray-700 border border-gray-600 text-white text-base rounded-md focus:ring-blue-500 focus:border-blue-500 px-3 transition disabled:opacity-50"
                    aria-label="Pilih resolusi unduhan"
                >
                    <option value="original">Resolusi Asli</option>
                    <option value="720p">HD (720p)</option>
                    <option value="1080p">Full HD (1080p)</option>
                    <option value="1440p">2K (1440p)</option>
                    <option value="2160p">4K (2160p)</option>
                </select>
                <button 
                    onClick={handleDownload}
                    disabled={selectedImageIds.size === 0 || isLoading || isPreviewing}
                    className="flex-grow sm:flex-grow-0 bg-gradient-to-br from-green-600 to-green-500 text-white font-bold py-3 px-5 rounded-md transition-all duration-300 ease-in-out shadow-lg shadow-green-500/20 hover:shadow-xl hover:shadow-green-500/40 hover:-translate-y-px active:scale-95 active:shadow-inner text-base disabled:from-green-800 disabled:to-green-700 disabled:shadow-none disabled:cursor-not-allowed disabled:transform-none"
                >
                    {selectedImageIds.size > 1 ? `Unduh ${selectedImageIds.size} Gambar` : 'Unduh Gambar'}
                </button>
            </div>
        </div>
      </div>
    );
  };
  
  return (
    <div className="min-h-screen text-gray-100 flex flex-col">
      <Header />
      <main className={`flex-grow w-full max-w-[1600px] mx-auto p-4 md:p-8 flex justify-center ${images.length > 0 ? 'items-start' : 'items-center'}`}>
        {renderContent()}
      </main>
    </div>
  );
};

export default App;