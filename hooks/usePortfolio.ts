import { useState, useEffect, useCallback } from 'react';
import { GeneratedImage } from '../types';
import { saveImageToPortfolio, getPortfolio, deleteImageFromPortfolio } from '../services/db';

export const usePortfolio = () => {
  const [portfolio, setPortfolio] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await getPortfolio();
      setPortfolio(data);
    } catch (err) {
      console.error('Failed to load portfolio:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveImage = useCallback(async (image: GeneratedImage) => {
    await saveImageToPortfolio(image);
    await refresh();
  }, [refresh]);

  const deleteImage = useCallback(async (id: string) => {
    await deleteImageFromPortfolio(id);
    await refresh();
  }, [refresh]);

  return {
    portfolio,
    isLoading,
    saveImage,
    deleteImage,
    refresh
  };
};
