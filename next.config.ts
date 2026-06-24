import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // File uploads (company documents, entity documents, KYC) are sent to
      // Server Actions as multipart FormData and stored with a 25 MB per-file
      // cap (see MAX_DOC_BYTES / MAX_BYTES / MAX_BYTES_DEFAULT). Next caps the
      // Server Action request body at 1 MB by default, which silently rejected
      // any real-sized document — the upload threw "Body exceeded 1 MB limit"
      // before the action ran, crashing into the error boundary with no toast
      // and storing nothing. Raise the limit above the 25 MB file cap, with
      // headroom for multipart boundaries and the other form fields.
      bodySizeLimit: '30mb',
    },
  },
};

export default nextConfig;
