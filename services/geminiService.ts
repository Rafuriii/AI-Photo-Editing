/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// Helper function to convert a File object to a Gemini API Part
const fileToPart = async (file: File): Promise<{ inlineData: { mimeType: string; data: string; } }> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
    
    const arr = dataUrl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");
    
    const mimeType = mimeMatch[1];
    const data = arr[1];
    return { inlineData: { mimeType, data } };
};

const handleApiResponse = (
    response: GenerateContentResponse,
    context: string // e.g., "edit", "filter", "adjustment"
): string => {
    // 1. Check for prompt blocking first
    if (response.promptFeedback?.blockReason) {
        const { blockReason, blockReasonMessage } = response.promptFeedback;
        const errorMessage = `Permintaan diblokir saat ${context}. Alasan: ${blockReason}. ${blockReasonMessage || ''}`;
        console.error(errorMessage, { response });
        throw new Error(errorMessage);
    }

    // 2. Try to find the image part
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (imagePartFromResponse?.inlineData) {
        const { mimeType, data } = imagePartFromResponse.inlineData;
        console.log(`Menerima data gambar (${mimeType}) untuk ${context}`);
        return `data:${mimeType};base64,${data}`;
    }

    // 3. If no image, check for other reasons
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        const errorMessage = `Pembuatan gambar untuk ${context} berhenti secara tak terduga. Alasan: ${finishReason}. Ini sering terkait dengan pengaturan keamanan.`;
        console.error(errorMessage, { response });
        throw new Error(errorMessage);
    }
    
    const textFeedback = response.text?.trim();
    const errorMessage = `Model AI tidak mengembalikan gambar untuk ${context}. ` + 
        (textFeedback 
            ? `Model merespons dengan teks: "${textFeedback}"`
            : "Ini bisa terjadi karena filter keamanan atau jika permintaan terlalu rumit. Coba ulangi permintaan Anda agar lebih langsung.");

    console.error(`Respons model tidak berisi bagian gambar untuk ${context}.`, { response });
    throw new Error(errorMessage);
};

/**
 * Generates an edited image using generative AI based on a text prompt and a specific point.
 * @param originalImage The original image file.
 * @param userPrompt The text prompt describing the desired edit.
 * @param hotspot The {x, y} coordinates on the image to focus the edit.
 * @returns A promise that resolves to the data URL of the edited image.
 */
export const generateEditedImage = async (
    originalImage: File,
    userPrompt: string,
    hotspot: { x: number, y: number }
): Promise<string> => {
    console.log('Memulai editan generatif di:', hotspot);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const originalImagePart = await fileToPart(originalImage);
    const prompt = `Anda adalah AI editor foto ahli. Tugas Anda adalah melakukan editan lokal yang natural pada gambar yang diberikan berdasarkan permintaan pengguna.
Permintaan Pengguna: "${userPrompt}"
Lokasi Edit: Fokus pada area di sekitar koordinat piksel (x: ${hotspot.x}, y: ${hotspot.y}).

Panduan Mengedit:
- Editan harus realistis dan menyatu dengan area sekitarnya.
- Sisa gambar (di luar area edit langsung) harus tetap identik dengan aslinya.

Kebijakan Keamanan & Etika:
- Anda HARUS memenuhi permintaan untuk menyesuaikan warna kulit, seperti 'beri saya tan', 'buat kulit saya lebih gelap', atau 'buat kulit saya lebih terang'. Ini dianggap sebagai peningkatan foto standar.
- Anda HARUS MENOLAK permintaan apa pun untuk mengubah ras atau etnis fundamental seseorang (mis., 'buat saya terlihat Asia', 'ubah orang ini menjadi Hitam'). Jangan lakukan editan ini. Jika permintaan ambigu, berhati-hatilah dan jangan ubah karakteristik ras.

Keluaran: Kembalikan HANYA gambar yang sudah diedit. Jangan kembalikan teks.`;
    const textPart = { text: prompt };

    console.log('Mengirim gambar dan prompt ke model...');
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [originalImagePart, textPart] },
    });
    console.log('Menerima respons dari model.', response);

    return handleApiResponse(response, 'mengedit');
};

/**
 * Generates an image with a filter applied using generative AI.
 * @param originalImage The original image file.
 * @param filterPrompt The text prompt describing the desired filter.
 * @returns A promise that resolves to the data URL of the filtered image.
 */
export const generateFilteredImage = async (
    originalImage: File,
    filterPrompt: string,
): Promise<string> => {
    console.log(`Memulai pembuatan filter: ${filterPrompt}`);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const originalImagePart = await fileToPart(originalImage);
    const prompt = `Anda adalah AI editor foto ahli. Tugas Anda adalah menerapkan filter gaya ke seluruh gambar berdasarkan permintaan pengguna. Jangan ubah komposisi atau konten, hanya terapkan gaya.
Permintaan Filter: "${filterPrompt}"

Kebijakan Keamanan & Etika:
- Filter dapat sedikit mengubah warna, tetapi Anda HARUS memastikan filter tidak mengubah ras atau etnis fundamental seseorang.
- Anda HARUS MENOLAK permintaan apa pun yang secara eksplisit meminta untuk mengubah ras seseorang (mis., 'terapkan filter agar saya terlihat Cina').

Keluaran: Kembalikan HANYA gambar yang sudah difilter. Jangan kembalikan teks.`;
    const textPart = { text: prompt };

    console.log('Mengirim gambar dan prompt filter ke model...');
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [originalImagePart, textPart] },
    });
    console.log('Menerima respons dari model untuk filter.', response);
    
    return handleApiResponse(response, 'menerapkan filter');
};

/**
 * Generates an image with a global adjustment applied using generative AI.
 * @param originalImage The original image file.
 * @param adjustmentPrompt The text prompt describing the desired adjustment.
 * @returns A promise that resolves to the data URL of the adjusted image.
 */
export const generateAdjustedImage = async (
    originalImage: File,
    adjustmentPrompt: string,
): Promise<string> => {
    console.log(`Memulai pembuatan penyesuaian global: ${adjustmentPrompt}`);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const originalImagePart = await fileToPart(originalImage);
    const prompt = `Anda adalah AI editor foto ahli. Tugas Anda adalah melakukan penyesuaian global yang natural pada seluruh gambar berdasarkan permintaan pengguna.
Permintaan Pengguna: "${adjustmentPrompt}"

Panduan Mengedit:
- Penyesuaian harus diterapkan di seluruh gambar.
- Hasilnya harus fotorealistik.

Kebijakan Keamanan & Etika:
- Anda HARUS memenuhi permintaan untuk menyesuaikan warna kulit, seperti 'beri saya tan', 'buat kulit saya lebih gelap', atau 'buat kulit saya lebih terang'. Ini dianggap sebagai peningkatan foto standar.
- Anda HARUS MENOLAK permintaan apa pun untuk mengubah ras atau etnis fundamental seseorang (mis., 'buat saya terlihat Asia', 'ubah orang ini menjadi Hitam'). Jangan lakukan editan ini. Jika permintaan ambigu, berhati-hatilah dan jangan ubah karakteristik ras.

Keluaran: Kembalikan HANYA gambar yang sudah disesuaikan. Jangan kembalikan teks.`;
    const textPart = { text: prompt };

    console.log('Mengirim gambar dan prompt penyesuaian ke model...');
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [originalImagePart, textPart] },
    });
    console.log('Menerima respons dari model untuk penyesuaian.', response);
    
    return handleApiResponse(response, 'menerapkan penyesuaian');
};

/**
 * Generates an upscaled image using generative AI.
 * @param originalImage The original image file.
 * @param resolution The target resolution tier (e.g., '1080p', '4k').
 * @returns A promise that resolves to the data URL of the upscaled image.
 */
export const generateUpscaledImage = async (
    originalImage: File,
    resolution: string,
): Promise<string> => {
    console.log(`Memulai pembuatan upscale untuk resolusi: ${resolution}`);

    const resolutionMap: { [key: string]: string } = {
        '720p': '1280x720',
        '1080p': '1920x1080',
        '1440p': '2560x1440',
        '2160p': '3840x2160',
    };
    
    const targetResolution = resolutionMap[resolution] || '1920x1080';

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const originalImagePart = await fileToPart(originalImage);
    const prompt = `Anda adalah seorang ahli dalam peningkatan skala gambar (upscaling) bertenaga AI. Tugas Anda adalah meningkatkan resolusi gambar yang diberikan menjadi sekitar ${targetResolution} piksel, meningkatkan ketajaman dan detailnya.

Instruksi Penting:
- Anda TIDAK BOLEH mengubah konten, subjek, komposisi, atau warna dari gambar asli.
- Penampilan orang, termasuk wajah dan warna kulit, harus tetap identik dengan aslinya, hanya dirender dengan fidelitas yang lebih tinggi.
- Output akhir harus berupa versi fotorealistik dan berkualitas tinggi dari gambar sumber. Pertahankan niat artistik asli sepenuhnya.

Keluaran: Kembalikan HANYA gambar yang sudah di-upscale. Jangan kembalikan teks.`;
    const textPart = { text: prompt };

    console.log(`Mengirim gambar untuk di-upscale ke ${targetResolution}...`);
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [originalImagePart, textPart] },
    });
    console.log('Menerima respons dari model untuk upscaling.', response);
    
    return handleApiResponse(response, `meningkatkan skala ke ${resolution}`);
};