export function downloadUrl(url: string, name: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  // Cross-origin URLs ignore `download`; open them without replacing the app.
  if (!url.startsWith('blob:')) link.target = '_blank';
  link.click();
  // Revoking synchronously can cancel the download in some browsers.
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60000);
}
