import { useFetcher } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";

export function useImport() {
  const importFetcher = useFetcher();
  const pdfFetcher = useFetcher();
  const pendingFileRef = useRef<File | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<string | null>(null);

  const handleImport = useCallback(
    (files: { path: string; title: string; content: string }[]) => {
      importFetcher.submit(
        { intent: "import", files: JSON.stringify(files) },
        { method: "post" }
      );
    },
    [importFetcher]
  );

  // When pdfFetcher returns a duplicate response, show prompt
  useEffect(() => {
    if (pdfFetcher.state !== "idle" || !pdfFetcher.data) return;
    const data = pdfFetcher.data as Record<string, unknown>;
    if (data.duplicate && pendingFileRef.current) {
      setDuplicatePrompt(data.duplicateTitle as string);
    } else {
      pendingFileRef.current = null;
    }
  }, [pdfFetcher.state, pdfFetcher.data]);

  const confirmDuplicate = useCallback(() => {
    const file = pendingFileRef.current;
    pendingFileRef.current = null;
    setDuplicatePrompt(null);
    if (!file) return;
    const formData = new FormData();
    formData.set("intent", "upload-file");
    formData.set("file", file);
    formData.set("force", "true");
    pdfFetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  }, [pdfFetcher]);

  const cancelDuplicate = useCallback(() => {
    pendingFileRef.current = null;
    setDuplicatePrompt(null);
  }, []);

  const handleUploadFile = useCallback(
    (file: File) => {
      pendingFileRef.current = file;
      const formData = new FormData();
      formData.set("intent", "upload-file");
      formData.set("file", file);
      pdfFetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });
    },
    [pdfFetcher]
  );

  const uploadFetcher = useFetcher();
  const handleUploadFiles = useCallback(
    (files: { file: File; path?: string }[]) => {
      const formData = new FormData();
      formData.set("intent", "upload-files");
      for (const { file, path } of files) {
        formData.append("files", file);
        formData.append("paths", path || file.name);
      }
      uploadFetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });
    },
    [uploadFetcher]
  );

  return {
    handleImport,
    handleUploadFile,
    handleUploadFiles,
    duplicatePrompt,
    confirmDuplicate,
    cancelDuplicate,
  };
}
