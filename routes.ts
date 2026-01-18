import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { upload } from "./index";
import { uploadBufferToObjectStorage } from "./objectStorageUpload";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ============================================
  // ADMIN AUTHENTICATION ENDPOINTS
  // ============================================
  app.post(api.admin.login.path, async (req, res) => {
    try {
      const input = api.admin.login.input.parse(req.body);
      if (input.password === ADMIN_PASSWORD) {
        const token = Buffer.from(`admin:${Date.now()}`).toString("base64");
        return res.json({ token });
      }
      res.status(401).json({ message: "Invalid password" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get(api.admin.me.path, (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    res.json({ authenticated });
  });

  // ============================================
  // SERVICE REQUEST ENDPOINTS
  // ============================================
  app.post(api.serviceRequests.create.path, async (req, res) => {
    try {
      const input = api.serviceRequests.create.input.parse(req.body);
      const request = await storage.createServiceRequest(input);
      res.status(201).json({ id: request.id, message: "Request submitted successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get(api.serviceRequests.list.path, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const requests = await storage.getServiceRequests();
    res.json(requests);
  });

  app.get(api.serviceRequests.get.path, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const request = await storage.getServiceRequest(Number(req.params.id));
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }
    res.json(request);
  });

  app.patch(api.serviceRequests.update.path, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const input = api.serviceRequests.update.input.parse(req.body);
      const updated = await storage.updateServiceRequestStatus(
        Number(req.params.id),
        input.status
      );
      if (!updated) {
        return res.status(404).json({ message: "Request not found" });
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // ============================================
  // CONTENT ENDPOINTS
  // ============================================
  app.get(api.content.list.path, async (req, res) => {
    const type = req.query.type as string | undefined;
    let content = await storage.getContentItems();
    if (type) {
      content = content.filter((c) => c.type === type);
    }
    res.json(content);
  });

  app.post(api.content.create.path, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const input = api.content.create.input.parse(req.body);
      const item = await storage.createContentItem(input);
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Server error" });
    }
  });

  // Custom middleware to handle both image and video uploads
  const uploadAny = upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]);

  // File upload endpoint for content
  app.post("/api/content/upload", uploadAny, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const files = req.files as { [key: string]: Express.Multer.File[] };
      const file = files?.image?.[0] || files?.video?.[0];

      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { title, description, type, category, isFavourite, isPublished } = req.body;
      
      const uploadResult = await uploadBufferToObjectStorage(
        file.buffer,
        file.originalname,
        file.mimetype,
        "content"
      );

      const item = await storage.createContentItem({
        type: type || "news",
        title,
        description: description || "",
        url: uploadResult.url,
        imageUrl: type === "news" ? uploadResult.url : undefined,
        fileUrl: type !== "news" ? uploadResult.url : undefined,
        filename: uploadResult.filename,
        category: category || null,
        isFavourite: isFavourite === "true",
        isPublished: isPublished === "true",
      });

      res.status(201).json(item);
    } catch (err) {
      console.error("Content upload error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.patch(api.content.update.path, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const input = api.content.update.input.parse(req.body);
      const updated = await storage.updateContentItem(Number(req.params.id), input);
      if (!updated) {
        return res.status(404).json({ message: "Content not found" });
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.delete(api.content.delete.path, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await storage.deleteContentItem(Number(req.params.id));
    res.status(204).send();
  });

  // ============================================
  // VERIFIED CANDIDATES ENDPOINTS
  // ============================================
  app.get(api.verifiedCandidates.list.path, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    
    const candidates = authenticated
      ? await storage.getAllVerifiedCandidates()
      : await storage.getVerifiedCandidates();
    res.json(candidates);
  });

  app.post(api.verifiedCandidates.create.path, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const input = api.verifiedCandidates.create.input.parse(req.body);
      const candidate = await storage.createVerifiedCandidate(input);
      res.status(201).json(candidate);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Server error" });
    }
  });

  // File upload endpoint for verified candidates
  app.post("/api/verified-candidates/upload", upload.single("image"), async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image uploaded" });
      }

      const { fullName, title, company, bio, service, status } = req.body;
      
      const uploadResult = await uploadBufferToObjectStorage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        "candidates"
      );

      const candidate = await storage.createVerifiedCandidate({
        fullName,
        title,
        company: company || "",
        bio,
        service: service || "Candidate Verification",
        imageUrl: uploadResult.url,
        status: (status as "pending" | "approved" | "rejected") || "pending",
      });

      res.status(201).json(candidate);
    } catch (err) {
      console.error("Candidate upload error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.patch(api.verifiedCandidates.update.path, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const input = api.verifiedCandidates.update.input.parse(req.body);
      const updated = await storage.updateVerifiedCandidateStatus(
        Number(req.params.id),
        input.status
      );
      if (!updated) {
        return res.status(404).json({ message: "Candidate not found" });
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // ============================================
  // TEMPLATES ENDPOINTS
  // ============================================
  app.get("/api/templates", async (req, res) => {
    const templates = await storage.getTemplates();
    res.json(templates);
  });

  app.get("/api/templates/all", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const templates = await storage.getAllTemplates();
    res.json(templates);
  });

  app.post("/api/templates/upload", upload.single("file"), async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { title, description, fileType, isPublished } = req.body;
      
      const uploadResult = await uploadBufferToObjectStorage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        "templates"
      );

      const template = await storage.createTemplate({
        title,
        description: description || "",
        filename: uploadResult.filename,
        fileUrl: uploadResult.url,
        fileType: fileType as "pdf" | "docx" | "xlsx",
        isPublished: isPublished === "true",
      });

      res.status(201).json(template);
    } catch (err) {
      console.error("Template upload error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.patch("/api/templates/:id", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { isPublished } = req.body;
      const updated = await storage.updateTemplateStatus(Number(req.params.id), isPublished);
      if (!updated) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.delete("/api/templates/:id", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await storage.deleteTemplate(Number(req.params.id));
    res.status(204).send();
  });

  // ============================================
  // JOB POSTINGS ENDPOINTS
  // ============================================
  app.get("/api/jobs", async (req, res) => {
    const jobs = await storage.getJobs();
    res.json(jobs);
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const job = await storage.getJobById(Number(req.params.id));
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json(job);
  });

  app.get("/api/admin/jobs", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const jobs = await storage.getAllJobs();
    res.json(jobs);
  });

  app.post("/api/admin/jobs", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const job = await storage.createJob(req.body);
      res.status(201).json(job);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.patch("/api/admin/jobs/:id", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      // If only isPublished is being updated, use the simple status update
      if (Object.keys(req.body).length === 1 && req.body.isPublished !== undefined) {
        const updated = await storage.updateJobStatus(Number(req.params.id), req.body.isPublished);
        if (!updated) return res.status(404).json({ message: "Job not found" });
        res.json(updated);
      } else {
        // Full job update
        const updated = await storage.updateJob(Number(req.params.id), req.body);
        if (!updated) return res.status(404).json({ message: "Job not found" });
        res.json(updated);
      }
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.delete("/api/admin/jobs/:id", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await storage.deleteJob(Number(req.params.id));
    res.status(204).send();
  });

  app.post("/api/jobs/apply", upload.single("cv"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "CV is required" });
      }
      
      const uploadResult = await uploadBufferToObjectStorage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        "applications"
      );
      
      const application = await storage.createJobApplication({
        jobId: Number(req.body.jobId),
        fullName: req.body.fullName,
        email: req.body.email,
        phone: req.body.phone,
        state: req.body.state,
        city: req.body.city,
        cvFileName: uploadResult.filename,
        cvUrl: uploadResult.url,
        coverNote: req.body.coverNote || "",
      });
      res.status(201).json(application);
    } catch (err) {
      console.error("Job application upload error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Admin: Get all job applications
  app.get("/api/admin/job-applications", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const applications = await storage.getJobApplications();
    res.json(applications);
  });

  // ============================================
  // TRAINING REQUESTS ENDPOINTS
  // ============================================
  app.post("/api/training-requests", async (req, res) => {
    try {
      const request = await storage.createTrainingRequest({
        fullName: req.body.fullName,
        email: req.body.email,
        phone: req.body.phone,
        employmentStatus: req.body.employmentStatus || null,
        organizationName: req.body.organizationName || null,
        role: req.body.role || null,
        interestedTraining: req.body.interestedTraining,
        preferredStartDate: req.body.preferredStartDate || null,
        certificationRequired: req.body.certificationRequired || false,
        verifiedShortlist: req.body.verifiedShortlist || false,
      });
      res.status(201).json({ id: request.id, message: "Training request submitted successfully" });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/admin/training-requests", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const requests = await storage.getTrainingRequests();
    res.json(requests);
  });

  app.patch("/api/admin/training-requests/:id", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    let authenticated = false;
    if (token) {
      try {
        const decoded = Buffer.from(token, "base64").toString();
        authenticated = decoded.startsWith("admin:");
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { status } = req.body;
      const updated = await storage.updateTrainingRequestStatus(
        Number(req.params.id),
        status
      );
      if (!updated) {
        return res.status(404).json({ message: "Training request not found" });
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  return httpServer;
}
