const Message = require('../models/Message');
const Job = require('../models/Job');
const cloudinary = require('../config/cloudinary');
const { emitToUser } = require('../socket');

// Phone number patterns to mask (Nigerian numbers + common formats)
// We replace matched numbers with [phone hidden] to keep users in-app
const PHONE_PATTERNS = [
  /(\+?234[\s\-.]?)?0?[7-9][0-1]\d{8}/g,          // Nigerian mobile
  /\b0[7-9][0-1]\d{8}\b/g,                           // local 0xx format
  /\b(\d[\s\-.]?){10,13}\b/g,                        // generic 10-13 digit number sequences
];

const maskPhoneNumbers = (text) => {
  if (!text) return { masked: text, wasFiltered: false };
  let result = text;
  let wasFiltered = false;

  for (const pattern of PHONE_PATTERNS) {
    const replaced = result.replace(pattern, '[phone hidden]');
    if (replaced !== result) {
      wasFiltered = true;
      result = replaced;
    }
  }

  return { masked: result, wasFiltered };
};

// ── Helper: verify user is a party to the job ─────────────────────────────────
const getJobAndVerifyAccess = async (jobId, userId) => {
  const job = await Job.findById(jobId);
  if (!job) return { error: 'Job not found.', status: 404 };

  const isCustomer = job.customerId.toString() === userId.toString();
  const isArtisan = job.assignedArtisanId?.toString() === userId.toString();

  if (!isCustomer && !isArtisan) {
    return { error: 'Not authorized to access this chat.', status: 403 };
  }

  // Chat only available on active/completed jobs
  const validStatuses = ['accepted', 'in-progress', 'completed', 'disputed'];
  if (!validStatuses.includes(job.status)) {
    return { error: 'Chat is only available once a job is accepted.', status: 400 };
  }

  return { job, isCustomer, isArtisan };
};

// ─── GET /api/chat/:jobId — Load chat history ─────────────────────────────────
exports.getChatHistory = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const access = await getJobAndVerifyAccess(jobId, req.user._id);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    const messages = await Message.find({ jobId, isDeleted: false })
      .populate('senderId', 'name role')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Message.countDocuments({ jobId, isDeleted: false });

    res.status(200).json({
      success: true,
      data: messages.map((m) => ({
        id: m._id,
        senderId: m.senderId._id,
        senderName: m.senderId.name,
        senderRole: m.senderId.role,
        type: m.type,
        text: m.text,
        imageUrl: m.imageUrl,
        wasFiltered: m.wasFiltered,
        createdAt: m.createdAt,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    console.error('getChatHistory error:', err);
    res.status(500).json({ success: false, message: 'Failed to load chat.' });
  }
};

// ─── POST /api/chat/:jobId — Send a text message ─────────────────────────────
exports.sendMessage = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { text } = req.body;

    if (!text?.trim()) {
      return res.status(400).json({ success: false, message: 'Message text is required.' });
    }

    const access = await getJobAndVerifyAccess(jobId, req.user._id);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    const { masked, wasFiltered } = maskPhoneNumbers(text.trim());

    const message = await Message.create({
      jobId,
      senderId: req.user._id,
      type: 'text',
      text: masked,
      wasFiltered,
    });

    // Emit to the other party in real-time
    const { job } = access;
    const recipientId = access.isCustomer
      ? job.assignedArtisanId?.toString()
      : job.customerId.toString();

    const payload = {
      id: message._id,
      jobId,
      senderId: req.user._id,
      senderName: req.user.name,
      senderRole: req.user.role,
      type: 'text',
      text: masked,
      wasFiltered,
      createdAt: message.createdAt,
    };

    if (recipientId) {
      emitToUser(recipientId, 'new_message', payload);
    }

    res.status(201).json({ success: true, data: payload });
  } catch (err) {
    console.error('sendMessage error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
};

// ─── POST /api/chat/:jobId/image — Send an image message ─────────────────────
exports.sendImageMessage = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded.' });
    }

    const access = await getJobAndVerifyAccess(jobId, req.user._id);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    const message = await Message.create({
      jobId,
      senderId: req.user._id,
      type: 'image',
      imageUrl: req.file.path,
      imagePublicId: req.file.filename,
    });

    const { job } = access;
    const recipientId = access.isCustomer
      ? job.assignedArtisanId?.toString()
      : job.customerId.toString();

    const payload = {
      id: message._id,
      jobId,
      senderId: req.user._id,
      senderName: req.user.name,
      senderRole: req.user.role,
      type: 'image',
      imageUrl: req.file.path,
      createdAt: message.createdAt,
    };

    if (recipientId) {
      emitToUser(recipientId, 'new_message', payload);
    }

    res.status(201).json({ success: true, data: payload });
  } catch (err) {
    console.error('sendImageMessage error:', err);
    res.status(500).json({ success: false, message: 'Failed to send image.' });
  }
};
