# Anthropotomy – Uploads Directory

This directory stores all user-uploaded files.

## Structure
```
uploads/
  lessons/   → Lesson media files (PDF, video, images, 3D models attached to lessons)
  media/     → General media library files managed via teacher/media.html
```

## Security Notes
- PHP files in this directory are blocked by Apache (see .htaccess)
- Files are served with content-disposition headers
- Filenames are sanitized and randomized on upload
