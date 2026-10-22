/**
 * In-app license terms, shown once per license and per version.
 * Changing the text REQUIRES bumping TERMS_VERSION so every license holder accepts again.
 * Status: AI-generated draft, not legal advice. Counsel review is required before paid sale.
 */
export const TERMS_VERSION = "draft-2026-10-21";

export const TERMS_PARAGRAPHS: { title: string; body: string }[] = [
  {
    title: "Licence",
    body:
      "Archer Chain Analytics grants you a non-transferable licence to use Otâcimow on your own devices. " +
      "Your licence is identified by a transaction ID. It does not contain your name or email address.",
  },
  {
    title: "Sealing",
    body:
      "Every video you export is sealed. The seal is a small block added to the end of the file. It records the " +
      "SHA-256 fingerprint of the video, the time of export and your licence token. The seal and a list of your " +
      "exports stay on your device. Nothing is uploaded.",
  },
  {
    title: "What the seal does",
    body:
      "If a sealed file is changed in any way, verification fails. Social platforms re-encode uploads, which " +
      "removes the seal from the posted copy. Keep your sealed master: it is the file that proves your original.",
  },
  {
    title: "Traceability and responsibility",
    body:
      "If a sealed file appears elsewhere, the licence token inside it identifies the licence it came from. " +
      "You are responsible for keeping your licence private and for how your licence is used.",
  },
  {
    title: "Licence integrity",
    body:
      "The app checks the signature of your licence. If the licence is altered, the app stops exporting. " +
      "The app never deletes your projects or your exports.",
  },
  {
    title: "Replacement",
    body: "If your licence does not work, contact support and it will be replaced.",
  },
  {
    title: "Third-party software",
    body: "Otâcimow includes FFmpeg under the LGPL. See the notices supplied with the app.",
  },
];
