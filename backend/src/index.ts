import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import twilio from "twilio";
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { prisma } from "./prisma";
// Local type definition for LeadStatus (Prisma enum may not be exported in all environments)
type LeadStatus = "COLD" | "WARM" | "HOT" | "NOT_PICK";
import { determineLeadStatusFromTranscript, extractConversationMemory, decideScriptMode, decideObjectionStrategy, type ScriptMode as LeadScoringScriptMode, type ObjectionStrategy } from "./leadScoring";
import { detectEmotionAndUrgency, detectEmotionAndUrgencyWithContext } from "./emotionUrgencyDetection";
import { decideVoiceAndScript as decideVoiceAndScriptSimple } from "./voiceStrategyDecision";
import { decideVoiceAndScript } from "./voiceScriptController";
import { buildAIMessagesWithTone, getToneContextString } from "./aiPromptBuilder";
import { decideFollowUp, calculateFollowUpPlannedAt } from "./followUpDecision";
import { decideHumanHandoff } from "./handoffDecision";
import { generatePostCallIntelligence } from "./postCallIntelligence";
import { generateCallSelfReview, calculatePredictionAccuracy, type CallSelfReview } from "./callSelfReview";
import { predictCallOutcome } from "./callOutcomePrediction";
import { captureSuccessfulPatterns, learnFromSuccessfulCalls } from "./aiLearning";
import { eventBus, type SSEEvent } from "./eventBus";
import { decideNextConversationStep } from "./adaptiveConversationEngine";
import { recordOutcomePattern as recordCallOutcomePattern, suggestOptimizedStrategy } from "./callOutcomeLearning";
import { executeBatchSequence, stopBatchJob, pauseBatchJob, resumeBatchJob, getRetryMetadata, updateRetryMetadata } from "./batchOrchestrator";
import { getNextValidCallTime, formatNextCallTime } from "./timeWindow";
import { recordOutcomePattern, getTopPatterns } from "./outcomeLearning";
import { selectAdaptiveStrategy, type AdaptiveStrategyContext, selectBestStrategyForAutoApply, type AutoApplyStrategyResult } from "./adaptiveStrategy";
import { getScriptModeFromLeadStatus, getOpeningLine, getProbingQuestions, getMainPitchPoints, getClosingLine, ScriptMode as ConversationScriptMode } from "./conversationStrategy";
import { processLiveTranscriptChunk, endLiveMonitoring, getLiveCallState, isCallLive } from "./liveCallMonitor";





// Load environment variables (local development only)
// Production (Railway) relies on process.env directly
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Startup logging
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

console.log('[STARTUP] Environment:', NODE_ENV);
console.log('[STARTUP] PORT:', PORT, process.env.PORT ? '(from env)' : '(fallback to 4000)');

// Lazy Twilio client initialization (only create when needed, not at module level)
function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set');
  }
  
  return twilio(accountSid, authToken);
}

const app = express();

// Configure multer for file uploads (memory storage for CSV)
// Must be configured BEFORE bodyParser middleware
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Middleware - CORS configuration for multipart requests
// Must be applied BEFORE routes
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parser middleware (for JSON/form-urlencoded)
// Note: multer handles multipart/form-data, so this won't interfere
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check route - must NOT depend on Twilio or OpenAI
const serverStartTime = Date.now();
app.get('/health', async (req: Request, res: Response) => {
  res.json({ ok: true });
});

// SSE endpoint for real-time updates
app.get('/events', (req: Request, res: Response) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connection established' })}\n\n`);

  // Event handler to send events to this client
  const sendEvent = (event: SSEEvent) => {
    try {
      // Log payload in dev mode only
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] Emitting event:', JSON.stringify(event, null, 2));
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      console.error('Error sending SSE event:', err);
    }
  };

  // Listen for all events
  eventBus.on('event', sendEvent);

  // Cleanup on client disconnect
  req.on('close', () => {
    eventBus.removeListener('event', sendEvent);
    res.end();
  });
});
app.get("/test-call", async (_req: Request, res: Response) => {
  try {
    const to = process.env.TEST_CALL_TO;
    const from = process.env.TWILIO_PHONE_NUMBER;

    if (!to || !from) {
      return res.status(400).json({
        ok: false,
        error:
          "TEST_CALL_TO or TWILIO_PHONE_NUMBER not set in .env",
      });
    }

    const twilioClient = getTwilioClient();
    const call = await twilioClient.calls.create({
      to,
      from,
      // Twilio will fetch this URL which returns TwiML that speaks a message
      url: "https://demo.twilio.com/docs/voice.xml",
    });

    console.log("Started test call, SID:", call.sid);

    res.json({
      ok: true,
      message: "Test call started. Your phone should ring shortly.",
      callSid: call.sid,
    });
  } catch (err: any) {
    console.error("Twilio test call error:", err?.message || err);
    res.status(500).json({
      ok: false,
      error: "Failed to start test call",
      details: String(err?.message || err),
    });
  }
});


// Test endpoint to demonstrate AI prompt generation with tone context
app.get('/test-ai-prompt/:campaignContactId', async (req: Request, res: Response) => {
  try {
    const { campaignContactId } = req.params;
    
    if (!campaignContactId) {
      return res.status(400).json({ ok: false, error: "campaignContactId is required" });
    }
    
    // Fetch campaign contact with conversation memory
    // Using type assertion to handle fields that may not be in Prisma client yet
    const campaignContact: any = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
      include: { contact: true, campaign: { include: { property: true } } },
    });

    if (!campaignContact) {
      return res.status(404).json({ ok: false, error: "CampaignContact not found" });
    }

    // Extract conversation memory from stored data
    // Handle backward compatibility: use type assertions for fields that may not exist yet
    const conversationMemory = {
      questions: (campaignContact.lastQuestionsAsked as string[] | undefined) || [],
      objections: (campaignContact.objections as string[] | undefined) || [],
      sentiment: "neutral" as const, // Would be determined from latest call
      preferredLanguage: campaignContact.preferredLanguage || undefined,
    };

    // Get tone context based on status and sentiment trend
    const sentimentTrend = (campaignContact.sentimentTrend as string[] | undefined) || [];
    const toneContext = getToneContextString(campaignContact.status, sentimentTrend);

    // Build AI messages with tone-aware prompt
    const propertyInfo = campaignContact.campaign?.property?.name || "Property details not available";
    const campaignKnowledge = (campaignContact.campaign as any)?.campaignKnowledge || null;
    const voiceKnowledge = (campaignContact.campaign as any)?.voiceKnowledge || null;
    const knowledgeUsageMode = (campaignContact.campaign as any)?.knowledgeUsageMode || 'INTERNAL_ONLY';
    const messages = buildAIMessagesWithTone({
      status: campaignContact.status,
      sentimentTrend: sentimentTrend,
      conversationMemory: conversationMemory,
      userMessage: "Generate a brief opening script for this call. Keep it under 30 words.",
      propertyInfo: propertyInfo,
      campaignKnowledge: campaignKnowledge,
      voiceKnowledge: voiceKnowledge,
      knowledgeUsageMode: knowledgeUsageMode,
    });

    res.json({
      ok: true,
      campaignContactId: campaignContact.id,
      leadStatus: campaignContact.status,
      toneContext: toneContext,
      systemMessage: messages[0]?.content || "",
      userMessage: messages[1]?.content || "",
      conversationMemory: conversationMemory,
      sentimentTrend: sentimentTrend,
      note: "This demonstrates how tone context is generated. Use buildAIMessagesWithTone() when creating OpenAI prompts for calls.",
    });
  } catch (err: any) {
    console.error('AI prompt test error:', err);
    res.status(500).json({
      ok: false,
      error: 'Failed to generate AI prompt',
      details: err?.message || 'Unknown error'
    });
  }
});

// Test OpenAI route
app.get('/test-openai', async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ 
        error: 'OPENAI_API_KEY is not set in environment variables' 
      });
    }

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: 'Say hello in one short sentence.' }
      ],
      max_tokens: 50
    });

    const message = completion.choices[0]?.message?.content || 'No response from OpenAI';

    res.json({ 
      message,
      model: completion.model,
      usage: completion.usage
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ 
      error: 'Failed to call OpenAI API',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start server with database connection check
async function startServer() {
  try {
    console.log('[STARTUP] Starting Express server...');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[STARTUP] ✓ Server is running on port ${PORT}`);
      console.log(`[STARTUP] Environment: ${NODE_ENV}`);
    });
  } catch (error) {
    console.error('[STARTUP] FATAL: Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

app.get("/test-db", async (_req: Request, res: Response) => {
  try {
    // Upsert a test user
    const user = await prisma.user.upsert({
      where: { email: "test@botuser.com" },
      update: {},
      create: {
        email: "test@botuser.com",
        name: "Test Bot User",
      },
    });

    // Count how many users total
    const totalUsers = await prisma.user.count();

    res.json({
      ok: true,
      user,
      totalUsers,
    });
  } catch (err: any) {
    console.error("DB test error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to query DB",
      details: String(err?.message || err),
    });
  }
});

// Diagnostic endpoint to check campaigns table
app.get("/diagnostic/campaigns", async (_req: Request, res: Response) => {
  try {
    console.log("[DIAGNOSTIC] /diagnostic/campaigns - Checking database...");
    const campaignCount = await prisma.campaign.count();
    console.log("[DIAGNOSTIC] /diagnostic/campaigns - Total campaigns in DB:", campaignCount);
    
    const allCampaigns = await prisma.campaign.findMany({
      select: { id: true, name: true, propertyId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    console.log("[DIAGNOSTIC] /diagnostic/campaigns - Raw campaigns from DB:", JSON.stringify(allCampaigns, null, 2));
    
    res.json({
      ok: true,
      campaignCount,
      campaigns: allCampaigns,
      message: `Found ${campaignCount} campaign(s) in database`,
    });
  } catch (err: any) {
    console.error("[DIAGNOSTIC] /diagnostic/campaigns - Error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to query campaigns",
      details: String(err?.message || err),
      code: err?.code,
    });
  }
});

app.get("/test-seed", async (_req: Request, res: Response) => {
  try {
    // 1) Ensure a test user exists (same as /test-db)
    const user = await prisma.user.upsert({
      where: { email: "test@botuser.com" },
      update: {},
      create: {
        email: "test@botuser.com",
        name: "Test Bot User",
      },
    });

    // 2) Create a property
    const property = await prisma.property.create({
      data: {
        name: "Sample 2BHK in Pune",
        location: "Pune, Maharashtra",
        priceRange: "60–70L",
        config: "2BHK",
        builder: "Sample Builder",
      },
    });

    // 3) Create a campaign for that property
    const campaign = await prisma.campaign.create({
      data: {
        name: "Test Campaign 1",
        userId: user.id,
        propertyId: property.id,
      },
    });

    // 4) Create a contact (use YOUR phone so you can receive the call)
    const contact = await prisma.contact.create({
      data: {
        userId: user.id,
        name: "First Lead",
        phone: process.env.TEST_CALL_TO || "+91XXXXXXXXXX",
        email: "lead@example.com",
        source: "Test Seed",
      },
    });

    // 5) Link campaign + contact
    const campaignContact = await prisma.campaignContact.create({
      data: {
        campaignId: campaign.id,
        contactId: contact.id,
        status: "NOT_PICK",
      },
    });

    res.json({
      ok: true,
      user,
      property,
      campaign,
      contact,
      campaignContact,
    });
  } catch (err: any) {
    console.error("Seed error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to seed test data",
      details: String(err?.message || err),
    });
  }
});
app.get("/call/start/:campaignContactId", async (req: Request, res: Response) => {
  try {
    const { campaignContactId } = req.params;
    
    if (!campaignContactId) {
      return res.status(400).json({ ok: false, error: "campaignContactId is required" });
    }

    const campaignContact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
      include: { 
        contact: true,
        campaign: true,
      },
    }) as any;

    if (!campaignContact) {
      return res.status(404).json({ ok: false, error: "CampaignContact not found" });
    }

    // Determine script mode from lead status (STEP 20: Conversation Strategy Engine)
    const scriptMode = getScriptModeFromLeadStatus(campaignContact.status);

    // Build personalized caller intro if needed
    const campaign = campaignContact?.campaign as any;
    const callerIdentity = (campaign?.callerIdentityMode === 'PERSONALIZED') ? 'PERSONALIZED' : 'GENERIC';
    const callerName = campaign?.callerDisplayName || undefined;
    const preferredLanguage = campaignContact.preferredLanguage as "en" | "hi" | "hinglish" | undefined || "en";
    
    // Generate opening line using conversation strategy engine
    const openingLine = getOpeningLine({
      scriptMode,
      callerIdentity: callerIdentity as "GENERIC" | "PERSONALIZED",
      callerName,
      language: preferredLanguage,
    });
    
    // Legacy callerIntro for backward compatibility (used by existing code)
    const callerIntro = (() => {
      if (campaign?.callerIdentityMode === 'PERSONALIZED' && campaign?.callerDisplayName) {
        return `This is an automated call on behalf of ${campaign.callerDisplayName} regarding a property inquiry. `;
      }
      return 'This is an automated call regarding a property inquiry. ';
    })();

    // STEP 21: Check for human override (HARD RULE - override always takes priority)
    const extraContext = (campaignContact as any).extraContext;
    const hasHumanOverride = extraContext && typeof extraContext === 'object' && extraContext.overrideStrategy === true;
    
    // STEP 21: Auto-apply best strategy if enabled and no human override
    let autoAppliedStrategy: AutoApplyStrategyResult | null = null;
    let autoApplyReason = '';
    
    if (!hasHumanOverride && campaign?.autoStrategyEnabled === true) {
      try {
        autoAppliedStrategy = await selectBestStrategyForAutoApply(campaignContact.campaignId);
        if (autoAppliedStrategy) {
          autoApplyReason = 'Auto-applied best performing strategy from historical patterns';
        } else {
          autoApplyReason = 'No historical patterns available - using default strategy';
        }
      } catch (err: any) {
        // Graceful degradation: if auto-apply fails, continue with default strategy
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[AutoApply] Error selecting best strategy, using defaults:', err);
        }
        autoApplyReason = 'Error fetching patterns - using default strategy';
      }
    } else if (hasHumanOverride) {
      autoApplyReason = 'Human override active - skipping auto-apply';
    } else if (campaign?.autoStrategyEnabled !== true) {
      autoApplyReason = 'Auto-strategy disabled for this campaign';
    }

    // Select adaptive strategy before starting call
    const strategyContext: AdaptiveStrategyContext = {
      campaignId: campaignContact.campaignId,
      leadStatus: campaignContact.status,
      emotion: autoAppliedStrategy?.emotion || null, // Use auto-applied emotion if available
      urgencyLevel: autoAppliedStrategy?.urgencyLevel || null, // Use auto-applied urgency if available
      objections: campaignContact.objections || [],
    };
    
    const adaptiveStrategy = await selectAdaptiveStrategy(strategyContext);
    
    // STEP 21: Override with auto-applied strategy if available
    const finalScriptVariant = autoAppliedStrategy?.scriptVariant || adaptiveStrategy.scriptVariant;
    const finalVoiceTone = autoAppliedStrategy?.voiceTone || adaptiveStrategy.voiceTone;

    const to = campaignContact.contact.phone;
    const from = process.env.TWILIO_PHONE_NUMBER;

    if (!from) {
      return res.status(400).json({ ok: false, error: "TWILIO_PHONE_NUMBER not set" });
    }

    const twilioClient = getTwilioClient();
    const call = await twilioClient.calls.create({
      to,
      from,
      url: "https://329e26f3bac8.ngrok-free.app", // placeholder voice
    });

    // STEP 21: Create call log with auto-applied strategy if available (safe try/catch for backward compatibility)
    let callLog;
    try {
      callLog = await prisma.callLog.create({
        data: {
          campaignContactId: campaignContact.id,
          twilioCallSid: call.sid,
          scriptVariant: finalScriptVariant,
          voiceTone: finalVoiceTone,
          speechRate: adaptiveStrategy.speechRate,
          emotion: autoAppliedStrategy?.emotion || null,
          urgencyLevel: autoAppliedStrategy?.urgencyLevel || null,
        } as any, // Type assertion for backward compatibility
      });
    } catch (err: any) {
      // If fields don't exist, create without them
      if (err?.code === 'P2002' || err?.message?.includes('Unknown field')) {
        callLog = await prisma.callLog.create({
          data: {
            campaignContactId: campaignContact.id,
            twilioCallSid: call.sid,
          },
        });
      } else {
        throw err;
      }
    }
    
    // STEP 21: Emit STRATEGY_AUTO_APPLIED SSE event if strategy was auto-applied
    if (autoAppliedStrategy && !hasHumanOverride) {
      const eventData: any = {
        scriptVariant: autoAppliedStrategy.scriptVariant,
        voiceTone: autoAppliedStrategy.voiceTone,
        source: 'AUTO',
        reason: autoApplyReason,
      };
      
      if (autoAppliedStrategy.emotion) {
        eventData.emotion = autoAppliedStrategy.emotion;
      }
      if (autoAppliedStrategy.urgencyLevel) {
        eventData.urgencyLevel = autoAppliedStrategy.urgencyLevel;
      }
      
      const autoAppliedEvent: SSEEvent = {
        type: 'STRATEGY_AUTO_APPLIED',
        campaignId: campaignContact.campaignId,
        contactId: campaignContact.contactId,
        campaignContactId: campaignContact.id,
        data: eventData,
      };
      
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] STRATEGY_AUTO_APPLIED payload:', JSON.stringify(autoAppliedEvent, null, 2));
      }
      
      eventBus.emit('event', autoAppliedEvent);
    }

    // Store caller intro in the call started event so it's available when generating the script
    // The intro will be injected when buildAIMessagesWithTone is called with callerIntro parameter

    const updatedCampaignContact = await prisma.campaignContact.update({
      where: { id: campaignContact.id },
      data: {
        lastCallAt: new Date(),
      },
    });

    // Emit STRATEGY_SELECTED SSE event
    const strategySelectedEvent: SSEEvent = {
      type: 'STRATEGY_SELECTED',
      campaignId: campaignContact.campaignId,
      contactId: campaignContact.contactId,
      campaignContactId: campaignContact.id,
      data: {
        scriptVariant: adaptiveStrategy.scriptVariant,
        voiceTone: adaptiveStrategy.voiceTone,
        speechRate: adaptiveStrategy.speechRate,
        openingStrategy: adaptiveStrategy.openingStrategy,
        reason: adaptiveStrategy.reason.join('; '),
        scriptMode: scriptMode as any, // STEP 20: Expose ScriptMode to frontend (cast to union type)
        openingLine: openingLine, // STEP 20: Expose generated opening line
        probingQuestions: getProbingQuestions(scriptMode), // STEP 20: Expose probing questions
      },
    };
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] STRATEGY_SELECTED payload:', JSON.stringify(strategySelectedEvent, null, 2));
    }
    
    eventBus.emit('event', strategySelectedEvent);


    // Emit SSE event for call started
    const callStartedEvent: SSEEvent = {
      type: 'CALL_STARTED',
      campaignId: campaignContact.campaignId,
      contactId: campaignContact.contactId,
      campaignContactId: campaignContact.id,
      data: {
        ...(updatedCampaignContact.lastCallAt && { lastCallAt: updatedCampaignContact.lastCallAt.toISOString() }),
        callSid: call.sid,
        callLogId: callLog.id,
        scriptMode: scriptMode as any, // STEP 20: Expose ScriptMode to frontend (cast to union type)
        openingLine: openingLine, // STEP 20: Expose generated opening line
        // callerIntro will be available from campaign when generating opening script
      },
    };
    
    // Log in dev mode only
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] CALL_STARTED payload:', JSON.stringify(callStartedEvent, null, 2));
    }
    
    eventBus.emit('event', callStartedEvent);
    
    // STEP 23: Initialize live monitoring for this call
    // The live monitor will be updated as transcript chunks arrive

    res.json({
      ok: true,
      message: "Call started",
      to,
      callSid: call.sid,
      callLogId: callLog.id,
      scriptMode: scriptMode, // STEP 20: Expose ScriptMode to frontend
      openingLine: openingLine, // STEP 20: Expose generated opening line
      probingQuestions: getProbingQuestions(scriptMode), // STEP 20: Expose probing questions
    });
  } catch (err: any) {
    console.error("Start call error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to start call",
      details: String(err?.message || err),
    });
  }
});
app.post("/twilio/status", async (req: Request, res: Response) => {
  try {
    const { CallSid, CallStatus, CallDuration } = req.body as {
      CallSid?: string;
      CallStatus?: string;
      CallDuration?: string;
    };

    if (!CallSid) {
      return res.sendStatus(200);
    }

    // Find this call in our DB by Twilio CallSid
    const callLog = await prisma.callLog.findFirst({
      where: { twilioCallSid: CallSid },
    });

    if (!callLog) {
      // If we don't know this call, just return 200 so Twilio is happy
      return res.sendStatus(200);
    }

    let leadStatus: LeadStatus | null = null;

    // If call never really connected / failed → mark as NOT_PICK
    if (["no-answer", "busy", "failed"].includes(CallStatus || "")) {
      leadStatus = "NOT_PICK";
    }

    // Build update data safely for Prisma
    const callLogUpdateData: any = {
      endedAt: new Date(),
      durationSeconds: CallDuration ? Number(CallDuration) : null,
    };

    if (leadStatus) {
      callLogUpdateData.resultStatus = leadStatus;
    }

    // Update CallLog record
    let updatedCampaignContact: any = null;

    await prisma.$transaction(async (tx: any) => {
      await tx.callLog.update({
      where: { id: callLog.id },
      data: callLogUpdateData,
    });

    if (leadStatus) {
        updatedCampaignContact = await tx.campaignContact.update({
        where: { id: callLog.campaignContactId },
          data: { status: leadStatus },
          include: { campaign: true },
        });
      }
    });

    // Emit SSE event for call ended with status update (only if status was updated)
    if (leadStatus && updatedCampaignContact) {
      const callEndedEventData: any = {
        status: leadStatus,
        resultStatus: leadStatus,
        ...(CallDuration && { durationSeconds: Number(CallDuration) }),
        ...(updatedCampaignContact.lastCallAt && { lastCallAt: updatedCampaignContact.lastCallAt.toISOString() }),
      };
      
      if (callLog) {
        callEndedEventData.callLogId = callLog.id;
        if (callLog.twilioCallSid) {
          callEndedEventData.callSid = callLog.twilioCallSid;
        }
      }
      
      const callEndedEvent: SSEEvent = {
        type: 'CALL_ENDED',
        campaignId: updatedCampaignContact.campaignId,
        contactId: updatedCampaignContact.contactId,
        campaignContactId: updatedCampaignContact.id,
        data: callEndedEventData,
      };
      
      // Log in dev mode only
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] CALL_ENDED payload:', JSON.stringify(callEndedEvent, null, 2));
      }
      
      eventBus.emit('event', callEndedEvent);
    }

    // STEP 23: End live monitoring when call ends
    if (callLog) {
      endLiveMonitoring(callLog.id);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Twilio status webhook error:", err);
    // Always respond 200 so Twilio doesn't retry endlessly
    res.sendStatus(200);
  }
});

app.post("/debug/score", async (req: Request, res: Response) => {
  try {
    const { transcript, durationSeconds } = req.body as {
      transcript?: string;
      durationSeconds?: number;
    };

    if (!transcript || typeof durationSeconds !== "number") {
      return res.status(400).json({
        ok: false,
        error: "transcript (string) and durationSeconds (number) are required",
      });
    }

    const status = determineLeadStatusFromTranscript({
      transcript,
      durationSeconds,
    });

    res.json({
      ok: true,
      status,
    });
  } catch (err: any) {
    console.error("Debug score error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to score lead",
      details: String(err?.message || err),
    });
  }
});
app.post("/debug/apply-score", async (req: Request, res: Response) => {
  try {
    const { callLogId, transcript, durationSeconds } = req.body as {
      callLogId?: string;
      transcript?: string;
      durationSeconds?: number;
    };

    if (!callLogId) {
      return res.status(400).json({
        ok: false,
        error: "callLogId is required",
      });
    }

    if (!transcript) {
      return res.status(400).json({
        ok: false,
        error: "transcript is required",
      });
    }

    // If duration not sent, assume 60 seconds as a fallback
    const duration = typeof durationSeconds === "number" ? durationSeconds : 60;

    // 1) Find the CallLog + its CampaignContact
    const callLog = await prisma.callLog.findUnique({
      where: { id: callLogId },
    });

    if (!callLog) {
      return res.status(404).json({
        ok: false,
        error: "CallLog not found",
      });
    }

    // 2) Determine lead status using our scoring function (backward compatible)
    const status = determineLeadStatusFromTranscript({
      transcript,
      durationSeconds: duration,
    });

    // 2.5) Detect emotion and urgency from transcript and duration using simple detection
    let emotionAndUrgency;
    try {
      emotionAndUrgency = detectEmotionAndUrgency(transcript, duration);
    } catch (err) {
      // If detection fails, continue without emotion/urgency (backward compatibility)
      console.error('[EmotionUrgency] Error detecting emotion and urgency:', err);
      emotionAndUrgency = {
        emotion: "calm" as const,
        urgencyLevel: "low" as const,
        urgencyReason: "Detection failed, defaulting to calm/low",
      };
    }

    // 2.4.1) Get existing CampaignContact early to check for human overrides
    // We need to read it early so AI can respect overrides
    let existingCampaignContact: any = null;
    let humanOverride: any = null;
    try {
      existingCampaignContact = await prisma.campaignContact.findUnique({
        where: { id: callLog.campaignContactId },
      });
      humanOverride = existingCampaignContact ? getHumanOverride(existingCampaignContact) : null;
    } catch (err) {
      // If query fails, continue without existing data (backward compatible)
      console.warn('[LeadScoring] Could not read existing campaign contact:', err);
    }

    // 2.5.1) Decide voice and script strategy based on detected emotion and urgency
    let voiceStrategyDecision;
    try {
      if (emotionAndUrgency) {
        voiceStrategyDecision = decideVoiceAndScriptSimple(
          emotionAndUrgency.emotion,
          emotionAndUrgency.urgencyLevel
        );
        
        // Apply human override if exists (human override always wins)
        if (humanOverride) {
          if (humanOverride.voiceTone) {
            voiceStrategyDecision.voiceTone = humanOverride.voiceTone as any;
          }
          if (humanOverride.speechRate) {
            voiceStrategyDecision.speechRate = humanOverride.speechRate as any;
          }
        }
      }
    } catch (err) {
      // If decision fails, continue without voice strategy (backward compatibility)
      console.error('[VoiceStrategy] Error deciding voice and script:', err);
      voiceStrategyDecision = {
        voiceTone: 'neutral' as const,
        speechRate: 'normal' as const,
        scriptVariant: 'DISCOVERY_SOFT' as const,
      };
    }

    // 2.6) Decide script mode based on lead status, emotion, and urgency
    let scriptMode: LeadScoringScriptMode | undefined;
    try {
      // Check human override first - if scriptMode is overridden, use it
      if (humanOverride && humanOverride.scriptMode) {
        scriptMode = humanOverride.scriptMode as LeadScoringScriptMode;
      } else if (emotionAndUrgency) {
        // Map 'hesitant' to 'anxious' for decideScriptMode compatibility
        const mappedEmotion = emotionAndUrgency.emotion === 'hesitant' ? 'anxious' : 
          (emotionAndUrgency.emotion === 'calm' ? 'calm' :
          emotionAndUrgency.emotion === 'excited' ? 'excited' :
          emotionAndUrgency.emotion === 'frustrated' ? 'frustrated' : 'calm');
        scriptMode = decideScriptMode({
          leadStatus: status,
          emotion: mappedEmotion as 'calm' | 'excited' | 'anxious' | 'frustrated' | 'confused',
          urgencyLevel: emotionAndUrgency.urgencyLevel,
        });
      }
    } catch (err) {
      // If decision fails, continue without script mode (backward compatibility)
      console.error('[LeadScoring] Error deciding script mode:', err);
      scriptMode = undefined;
    }

    // 3) Extract conversation memory from transcript
    // This extracts questions, objections, sentiment, preferred language, and primary objection
    let conversationMemory;
    try {
      conversationMemory = extractConversationMemory(transcript);
    } catch (err) {
      // If extraction fails, continue with empty memory (backward compatibility)
      console.error('[LeadScoring] Error extracting conversation memory:', err);
      conversationMemory = {
        questions: [],
        objections: [],
        sentiment: "neutral" as const,
        preferredLanguage: undefined,
        primaryObjection: null,
      };
    }

    // 3.5) Decide objection strategy based on primary objection
    let objectionStrategy: ObjectionStrategy | null = null;
    try {
      if (conversationMemory?.primaryObjection) {
        objectionStrategy = decideObjectionStrategy(conversationMemory.primaryObjection);
      }
    } catch (err) {
      // If decision fails, continue without objection strategy (backward compatibility)
      console.error('[LeadScoring] Error deciding objection strategy:', err);
      objectionStrategy = null;
    }

    // 3.6) Decide adaptive conversation step based on emotion, urgency, and engagement
    let adaptiveStepDecision;
    try {
      if (emotionAndUrgency && conversationMemory) {
        // Check human override first - if scriptMode is overridden, use it
        let finalScriptMode = scriptMode;
        if (humanOverride && humanOverride.scriptMode) {
          // Map human override scriptMode to adaptive engine format if needed
          finalScriptMode = humanOverride.scriptMode as LeadScoringScriptMode;
        }
        
        // Map emotion types for adaptive engine (uses 'positive' instead of 'excited')
        const adaptiveEmotion = emotionAndUrgency.emotion === 'excited' ? 'positive' :
          emotionAndUrgency.emotion === 'frustrated' ? 'frustrated' :
          emotionAndUrgency.emotion === 'hesitant' ? 'confused' :
          'calm';
        
        // Map script mode for adaptive engine (convert from leadScoring types)
        const adaptiveScriptMode = finalScriptMode === 'CLOSING' ? 'CLOSING' :
          (finalScriptMode === 'COOL_DOWN' ? 'OBJECTION_HANDLING' :
          finalScriptMode === 'FAST_TRACK' ? 'PITCH' :
          'DISCOVERY');
        
        adaptiveStepDecision = decideNextConversationStep({
          transcriptChunk: transcript,
          currentEmotion: adaptiveEmotion as 'calm' | 'positive' | 'frustrated' | 'angry' | 'confused',
          urgencyLevel: emotionAndUrgency.urgencyLevel,
          objections: conversationMemory.objections.map(obj => typeof obj === 'string' ? obj : String(obj)),
          questionsCount: conversationMemory.questions.length,
          durationSeconds: duration,
          scriptMode: adaptiveScriptMode as 'DISCOVERY' | 'PITCH' | 'OBJECTION_HANDLING' | 'CLOSING',
        });
        
        // Apply human override if exists (human override always wins)
        if (humanOverride) {
          if (humanOverride.scriptMode) {
            // Map override scriptMode to adaptive format
            const overrideScriptMode = humanOverride.scriptMode === 'CLOSING' ? 'CLOSING' :
              (humanOverride.scriptMode === 'COOL_DOWN' || humanOverride.scriptMode === 'OBJECTION' ? 'OBJECTION_HANDLING' :
              humanOverride.scriptMode === 'FAST_TRACK' ? 'PITCH' :
              'DISCOVERY');
            adaptiveStepDecision.nextScriptMode = overrideScriptMode;
          }
        }
      }
    } catch (err) {
      // If decision fails, continue without adaptive step (backward compatibility)
      console.error('[AdaptiveConversation] Error deciding next conversation step:', err);
      adaptiveStepDecision = undefined;
    }

    // 4) Get existing CampaignContact to merge conversation memory
    // Note: We already read this earlier to check for human overrides
    // If we didn't get it earlier, try again now
    if (!existingCampaignContact) {
      try {
        existingCampaignContact = await prisma.campaignContact.findUnique({
          where: { id: callLog.campaignContactId },
        });
        // Update humanOverride if we just got the contact
        if (existingCampaignContact && !humanOverride) {
          humanOverride = getHumanOverride(existingCampaignContact);
        }
      } catch (err) {
        // If query fails, continue without existing data (backward compatible)
        console.warn('[LeadScoring] Could not read existing campaign contact:', err);
      }
    }

    // 5) Merge new conversation memory with existing data
    // Handle backward compatibility: if fields don't exist, start with empty arrays
    // Use type assertions to handle Prisma client that may not have been regenerated
    const existingQuestions = (existingCampaignContact?.lastQuestionsAsked as string[] | undefined) || [];
    const existingObjections = (existingCampaignContact?.objections as string[] | undefined) || [];
    const existingSentimentTrend = (existingCampaignContact?.sentimentTrend as string[] | undefined) || [];

    // Merge questions: add new questions that aren't already tracked
    const mergedQuestions = [
      ...existingQuestions,
      ...conversationMemory.questions.filter((q) => !existingQuestions.includes(q)),
    ];

    // Merge objections: add new objections that aren't already tracked
    // Normalize to uppercase format (PRICE, LOCATION, TRUST, TIMING, FINANCING) for consistency
    // Handle both old lowercase and new uppercase formats for backward compatibility
    const normalizedExisting = (existingObjections as string[]).map((o) => 
      typeof o === "string" ? o.toUpperCase() : o
    );
    const normalizedNew = conversationMemory.objections
      .map((o) => (typeof o === "string" ? o.toUpperCase() : o))
      .filter((o) => !normalizedExisting.includes(o as string));
    
    const mergedObjections = [...normalizedExisting, ...normalizedNew];

    // Append new sentiment to trend (keep last 10 sentiment readings for trend analysis)
    const mergedSentimentTrend = [
      ...existingSentimentTrend,
      conversationMemory.sentiment,
    ].slice(-10); // Keep only last 10 sentiment readings

    // Use detected language if available, otherwise keep existing or undefined
    const preferredLanguage = conversationMemory.preferredLanguage || existingCampaignContact?.preferredLanguage || undefined;

    // 5.5) Decide human handoff recommendation based on lead engagement and complexity
    // Triggers: HOT + complex questions (3+), multiple objections (>2), strong buying intent
    // Pass conversationMemory if it's properly structured, otherwise use campaignContact data directly
    const handoffDecision = decideHumanHandoff(
      {
        status: status,
        lastQuestionsAsked: mergedQuestions,
        objections: mergedObjections,
      },
      conversationMemory.preferredLanguage ? conversationMemory : undefined,
      transcript
    );

    // 5.6) Decide follow-up plan based on lead status
    // This creates an automated follow-up plan that can be executed later
    // The decision is based on lead status: HOT → call in 2h, WARM → call in 48h, COLD → WhatsApp in 24h, NOT_PICK → retry call in 24h
    let followUpDecision = decideFollowUp({
      status: status, // Use the newly determined status
      lastCallAt: existingCampaignContact?.lastCallAt || new Date(), // Use last call time or current time
    });
    
    // Apply human override for follow-up if exists (human override always wins)
    if (humanOverride) {
      if (humanOverride.followUpChannel !== undefined) {
        followUpDecision.followUpChannel = humanOverride.followUpChannel;
      }
      if (humanOverride.followUpAfterHours !== undefined) {
        followUpDecision.followUpAfterHours = humanOverride.followUpAfterHours;
      }
    }
    
    // Calculate when follow-up should be executed (for easy querying by automation)
    const followUpPlannedAt = calculateFollowUpPlannedAt(
      existingCampaignContact?.lastCallAt || new Date(),
      followUpDecision.followUpAfterHours
    );

    // 5.7) Predict call outcome based on all collected metrics
    // This provides a deterministic probability score and recommendations
    const predictionInput: {
      status: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
      durationSeconds: number;
      questionsCount: number;
      objectionsCount: number;
      sentiment: 'negative' | 'neutral' | 'positive';
      followUpChannel?: string;
      followUpAfterHours?: number;
      handoffRecommended?: boolean;
    } = {
      status,
      durationSeconds: duration,
      questionsCount: conversationMemory.questions.length,
      objectionsCount: conversationMemory.objections.length,
      sentiment: conversationMemory.sentiment,
      handoffRecommended: handoffDecision.handoffRecommended || false,
    };
    
    // Only include optional fields if they have values
    if (followUpDecision.followUpChannel) {
      predictionInput.followUpChannel = followUpDecision.followUpChannel;
    }
    if (followUpDecision.followUpAfterHours !== null && followUpDecision.followUpAfterHours !== undefined) {
      predictionInput.followUpAfterHours = followUpDecision.followUpAfterHours;
    }
    
    const callOutcomePrediction = predictCallOutcome(predictionInput);

    // 5.8) Detect emotion and urgency with context (outcome bucket + objections)
    // This provides enhanced detection using outcome prediction and objection data
    let emotionUrgencyContext;
    try {
      emotionUrgencyContext = detectEmotionAndUrgencyWithContext({
        transcript,
        durationSeconds: duration,
        objections: conversationMemory.objections.map(obj => typeof obj === 'string' ? obj : String(obj)),
        outcomeBucket: callOutcomePrediction.bucket,
      });
    } catch (err) {
      // If detection fails, continue without context (backward compatibility)
      console.error('[EmotionUrgency] Error detecting emotion and urgency with context:', err);
      emotionUrgencyContext = {
        emotion: 'calm' as const,
        urgencyLevel: 'low' as const,
        urgencyReason: 'Detection failed, defaulting to calm/low',
        scriptMode: 'DISCOVERY' as const,
      };
    }

    // 5.9) Decide voice and script parameters based on emotion, urgency, and script mode
    // This provides provider-agnostic voice modulation and multilingual script control
    let voiceScriptDecision;
    try {
      const voiceScriptInput: {
        emotion: 'calm' | 'excited' | 'frustrated' | 'hesitant';
        urgencyLevel: 'low' | 'medium' | 'high';
        scriptMode: 'DISCOVERY' | 'OBJECTION' | 'CLOSING';
        preferredLanguage?: 'en' | 'hi' | 'hinglish';
      } = {
        emotion: emotionUrgencyContext.emotion,
        urgencyLevel: emotionUrgencyContext.urgencyLevel,
        scriptMode: emotionUrgencyContext.scriptMode,
      };
      
      // Only include preferredLanguage if it's defined
      if (conversationMemory.preferredLanguage) {
        voiceScriptInput.preferredLanguage = conversationMemory.preferredLanguage;
      }
      
      voiceScriptDecision = decideVoiceAndScript(voiceScriptInput);
    } catch (err) {
      // If decision fails, continue without voice script parameters (backward compatibility)
      console.error('[VoiceScript] Error deciding voice and script:', err);
      voiceScriptDecision = {
        voiceTone: 'neutral' as const,
        speechRate: 'normal' as const,
        language: (conversationMemory.preferredLanguage || 'en') as 'en' | 'hi' | 'hinglish',
        scriptVariant: 'DISCOVERY_SOFT' as const,
      };
    }

    // 6) Generate post-call intelligence summary
    // This creates structured, actionable insights for sales team without reading full transcript
    // Ensure conversationMemory has proper structure
    const validConversationMemory = conversationMemory.preferredLanguage 
      ? conversationMemory 
      : { ...conversationMemory, preferredLanguage: undefined as any };
    const postCallIntelligence = generatePostCallIntelligence(
      transcript,
      duration,
      status,
      validConversationMemory
    );

    // 7) Update CallLog with transcript, duration, resultStatus, post-call intelligence, and emotion/urgency
    const callLogUpdateData: any = {
      transcript,
      durationSeconds: duration,
      resultStatus: status,
      // Post-call intelligence fields (now properly typed after migration)
      postCallSummary: postCallIntelligence.summary,
      postCallInterestLevel: postCallIntelligence.interestLevel,
      postCallObjections: postCallIntelligence.objections,
      postCallNextAction: postCallIntelligence.recommendedNextAction,
      postCallBestCallbackTime: postCallIntelligence.bestCallbackTime,
    };

    // Add emotion and urgency fields (with backward compatibility check)
    // Using type assertion to handle Prisma client that may not have been regenerated
    if (emotionAndUrgency) {
      callLogUpdateData.emotion = emotionAndUrgency.emotion;
      callLogUpdateData.urgencyLevel = emotionAndUrgency.urgencyLevel;
      callLogUpdateData.urgencyReason = emotionAndUrgency.urgencyReason;
    }

    // Add script mode field (with backward compatibility check)
    if (scriptMode) {
      callLogUpdateData.scriptMode = scriptMode;
    }

    // Add objection strategy field (with backward compatibility check)
    if (objectionStrategy) {
      callLogUpdateData.objectionStrategy = objectionStrategy;
    }

    // Add call outcome prediction fields (with backward compatibility check)
    try {
      callLogUpdateData.outcomeProbability = callOutcomePrediction.probabilityScore;
      callLogUpdateData.outcomeBucket = callOutcomePrediction.bucket;
      callLogUpdateData.outcomeAction = callOutcomePrediction.recommendedAction;
      callLogUpdateData.outcomeFollowUp = callOutcomePrediction.recommendedFollowUp;
      callLogUpdateData.outcomeConfidence = callOutcomePrediction.confidenceLevel;
    } catch (err) {
      // If schema doesn't support these fields yet, continue without them (backward compatibility)
      console.warn('[CallOutcome] Outcome prediction fields not available in schema. Run migration to enable persistence.');
    }

    // STEP 24: Generate AI self-review
    let selfReview: CallSelfReview | null = null;
    try {
      const predictionAccuracy = calculatePredictionAccuracy(
        callOutcomePrediction.bucket,
        callOutcomePrediction.bucket // Use same bucket for now, could compare with actual outcome later
      );

      selfReview = generateCallSelfReview({
        durationSeconds: duration,
        transcript,
        emotion: emotionAndUrgency?.emotion || null,
        urgencyLevel: emotionAndUrgency?.urgencyLevel || null,
        objections: conversationMemory.objections.filter(obj => typeof obj === 'string').map(obj => obj.toUpperCase()),
        questionsCount: conversationMemory.questions.length,
        scriptVariant: voiceStrategyDecision?.scriptVariant || voiceScriptDecision?.scriptVariant || null,
        voiceTone: voiceStrategyDecision?.voiceTone || voiceScriptDecision?.voiceTone || null,
        speechRate: voiceStrategyDecision?.speechRate || voiceScriptDecision?.speechRate || null,
        predictedBucket: callOutcomePrediction.bucket,
        actualStatus: status,
        outcomeBucket: callOutcomePrediction.bucket,
        predictionAccuracy,
      });

      // Store self-review in CallLog (using JSON field for backward compatibility)
      callLogUpdateData.aiSelfReview = selfReview as any;
    } catch (err: any) {
      // Graceful degradation: if self-review generation fails, continue without it
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[CallSelfReview] Error generating self-review:', err);
      }
    }

    // Add adaptive conversation step fields (with backward compatibility check)
    if (adaptiveStepDecision) {
      try {
        // Update scriptMode with adaptive decision if available
        if (adaptiveStepDecision.nextScriptMode) {
          // Map adaptive script mode back to our schema format if needed
          callLogUpdateData.scriptMode = adaptiveStepDecision.nextScriptMode;
        }
        // Store next prompt instruction (field may not exist in schema yet)
        callLogUpdateData.nextPromptInstruction = adaptiveStepDecision.nextPromptInstruction;
      } catch (err) {
        // If schema doesn't support these fields yet, continue without them (backward compatibility)
        console.warn('[AdaptiveConversation] Adaptive step fields not available in schema. Run migration to enable persistence.');
      }
    }

    // Add voice and script decision fields from simple decision (with backward compatibility check)
    if (voiceStrategyDecision) {
      try {
        callLogUpdateData.voiceTone = voiceStrategyDecision.voiceTone;
        callLogUpdateData.speechRate = voiceStrategyDecision.speechRate;
        callLogUpdateData.scriptVariant = voiceStrategyDecision.scriptVariant;
      } catch (err) {
        // If schema doesn't support these fields yet, continue without them (backward compatibility)
        console.warn('[VoiceStrategy] Voice and script fields not available in schema. Run migration to enable persistence.');
      }
    }

    // Add voice and script decision fields from context-aware decision (with backward compatibility check)
    if (voiceScriptDecision) {
      try {
        // Only update if not already set by simple decision (prefer simple decision for basic fields)
        if (!voiceStrategyDecision) {
          callLogUpdateData.voiceTone = voiceScriptDecision.voiceTone;
          callLogUpdateData.speechRate = voiceScriptDecision.speechRate;
          callLogUpdateData.scriptVariant = voiceScriptDecision.scriptVariant;
        }
        // Language is only available from context-aware decision
        callLogUpdateData.language = voiceScriptDecision.language;
      } catch (err) {
        // If schema doesn't support these fields yet, continue without them (backward compatibility)
        console.warn('[VoiceScript] Voice and script fields not available in schema. Run migration to enable persistence.');
      }
    }

    // 8) Update CampaignContact with status AND conversation memory
    // This stores persistent memory across all calls for this lead
    // Handle backward compatibility: only update memory fields if they exist in schema
    const updateData: any = {
      status, // Update lead status (existing HOT/WARM/COLD logic preserved)
    };

    // Only include memory fields if schema supports them (graceful degradation)
    // Using type assertion to handle Prisma client that may not have been regenerated
    // After running migration, these fields will be available
    updateData.lastQuestionsAsked = mergedQuestions;
    updateData.objections = mergedObjections;
    updateData.sentimentTrend = mergedSentimentTrend;
    if (preferredLanguage) {
      updateData.preferredLanguage = preferredLanguage;
    }

    // Store follow-up plan for future automation
    // These fields enable automated follow-up execution:
    // - followUpAfterHours: when to execute (relative to lastCallAt)
    // - followUpChannel: which channel to use (call/whatsapp/email)
    // - followUpMessageIntent: what message to send (guidance for AI, not hardcoded)
    // - followUpPlannedAt: absolute timestamp for easy querying (lastCallAt + followUpAfterHours)
    updateData.followUpAfterHours = followUpDecision.followUpAfterHours;
    updateData.followUpChannel = followUpDecision.followUpChannel;
    updateData.followUpMessageIntent = followUpDecision.followUpMessageIntent;
    updateData.followUpPlannedAt = followUpPlannedAt;

    // Store human handoff decision for notification/assignment (future integration)
    // handoffRecommended: true triggers human handoff workflow
    // handoffReason: reason code for routing/tagging (HOT_LEAD_COMPLEX_QUESTIONS, MULTIPLE_OBJECTIONS, STRONG_BUYING_INTENT_URGENCY)
    updateData.handoffRecommended = handoffDecision.handoffRecommended;
    updateData.handoffReason = handoffDecision.handoffReason;

    // Update with error handling for backward compatibility using transaction
    let updatedCallLog;
    let updatedCampaignContact;
    try {
      [updatedCallLog, updatedCampaignContact] = await prisma.$transaction([
        prisma.callLog.update({
          where: { id: callLog.id },
          data: callLogUpdateData,
        }),
        prisma.campaignContact.update({
          where: { id: callLog.campaignContactId },
          data: updateData,
        }),
      ]);
    } catch (err: any) {
      // If memory fields don't exist yet (migration not run), update status only
      if (err?.code === 'P2002' || err?.message?.includes('Unknown field')) {
        console.warn('[LeadScoring] Some fields not available, updating with basic fields only. Run migration to enable all features.');
        // Remove emotion/urgency fields if they cause errors (backward compatibility)
        const fallbackCallLogData: any = {
          transcript,
          durationSeconds: duration,
          resultStatus: status,
          postCallSummary: postCallIntelligence.summary,
          postCallInterestLevel: postCallIntelligence.interestLevel,
          postCallObjections: postCallIntelligence.objections,
          postCallNextAction: postCallIntelligence.recommendedNextAction,
          postCallBestCallbackTime: postCallIntelligence.bestCallbackTime,
          // Skip emotion/urgency fields if they don't exist in schema
        };
        [updatedCallLog, updatedCampaignContact] = await prisma.$transaction([
          prisma.callLog.update({
            where: { id: callLog.id },
            data: fallbackCallLogData,
          }),
          prisma.campaignContact.update({
      where: { id: callLog.campaignContactId },
            data: { status }, // Only update status
          }),
        ]);
      } else {
        throw err; // Re-throw if it's a different error
      }
    }

    // Apply smart retry logic for NOT_PICK results
    if (status === 'NOT_PICK') {
      const retryMeta = await getRetryMetadata(updatedCampaignContact.id);
      const newRetryCount = retryMeta.retryCount + 1;
      const now = new Date();
      
      let retryAction = '';
      let followUpChannel: string | null = null;
      
      if (newRetryCount === 1) {
        // Retry 1: +4h (same day window)
        const nextRetry = new Date(now.getTime() + 4 * 60 * 60 * 1000);
        const nextValidTime = getNextValidCallTime(nextRetry);
        retryAction = `Retry scheduled at ${formatNextCallTime(nextValidTime)} (+4h)`;
        await updateRetryMetadata(updatedCampaignContact.id, newRetryCount, retryAction);
      } else if (newRetryCount === 2) {
        // Retry 2: next day, alternate window
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextValidTime = getNextValidCallTime(tomorrow);
        retryAction = `Retry scheduled at ${formatNextCallTime(nextValidTime)} (next day, alternate window)`;
        await updateRetryMetadata(updatedCampaignContact.id, newRetryCount, retryAction);
      } else if (newRetryCount === 3) {
        // Retry 3: mark followUpChannel = WHATSAPP
        followUpChannel = 'WHATSAPP';
        retryAction = 'Switching to WhatsApp follow-up after 3 failed attempts';
        await prisma.campaignContact.update({
          where: { id: updatedCampaignContact.id },
          data: {
            followUpChannel: 'WHATSAPP',
          },
        });
        await updateRetryMetadata(updatedCampaignContact.id, newRetryCount, retryAction);
      } else if (newRetryCount >= 4) {
        // Retry >=4: mark lead DROPPED (set status to COLD)
        retryAction = 'Lead dropped after 3+ failed attempts';
        await prisma.campaignContact.update({
          where: { id: updatedCampaignContact.id },
          data: {
            status: 'COLD', // Mark as COLD (effectively dropped from active calling)
          },
        });
        await updateRetryMetadata(updatedCampaignContact.id, newRetryCount, retryAction);
      }
      
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[SmartRetry] Retry logic applied for ${updatedCampaignContact.id}: ${retryAction}`);
      }
    }

    // Check if lead became HOT and pause any active batch jobs
    if (status === 'HOT') {
      // Find active batch jobs for this campaign
      const activeBatchJobs = await prisma.batchCallJob.findMany({
        where: {
          campaignId: updatedCampaignContact.campaignId,
          status: 'RUNNING',
        },
      });
      
        // Pause all active batch jobs (lead became HOT)
        for (const batchJob of activeBatchJobs) {
          await prisma.batchCallJob.update({
          where: { id: batchJob.id },
          data: {
            status: 'PAUSED',
            pausedAt: new Date(),
          },
        });
        
        // Stop the batch execution
        stopBatchJob(batchJob.id);
        
        // Emit BATCH_PAUSED event
        const batchPausedEvent: SSEEvent = {
          type: 'BATCH_PAUSED',
          campaignId: updatedCampaignContact.campaignId,
          contactId: updatedCampaignContact.contactId,
          campaignContactId: updatedCampaignContact.id,
          data: {
            batchJobId: batchJob.id,
            currentIndex: batchJob.currentIndex,
            totalLeads: batchJob.totalLeads,
            reason: 'Lead became HOT',
          },
        };
        
        if (process.env.NODE_ENV !== 'production') {
          console.log('[SSE] BATCH_PAUSED (HOT lead) payload:', JSON.stringify(batchPausedEvent, null, 2));
        }
        
        eventBus.emit('event', batchPausedEvent);
      }
    }

    // Emit SSE event for lead update
    const leadUpdatedEvent: SSEEvent = {
      type: 'LEAD_UPDATED',
      campaignId: updatedCampaignContact.campaignId,
      contactId: updatedCampaignContact.contactId,
      campaignContactId: updatedCampaignContact.id,
      data: {
        status,
        durationSeconds: duration,
        resultStatus: status,
        ...(updatedCampaignContact.lastCallAt && { lastCallAt: updatedCampaignContact.lastCallAt.toISOString() }),
        // Include emotion and urgency in SSE event payload
        // Map 'hesitant' to 'anxious' for SSE event compatibility
        ...(emotionAndUrgency && {
          emotion: (emotionAndUrgency.emotion === 'hesitant' ? 'anxious' : emotionAndUrgency.emotion) as any,
          urgencyLevel: emotionAndUrgency.urgencyLevel,
        }),
        // Include script mode in SSE event payload
        ...(scriptMode && { scriptMode }),
        // Include objection strategy in SSE event payload
        ...(objectionStrategy && { objectionStrategy }),
      },
    };
    
    // Log in dev mode only
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] LEAD_UPDATED payload:', JSON.stringify(leadUpdatedEvent, null, 2));
    }
    
    eventBus.emit('event', leadUpdatedEvent);

    // Emit CALL_OUTCOME_PREDICTED SSE event
    const outcomePredictedEvent: SSEEvent = {
      type: 'CALL_OUTCOME_PREDICTED',
      campaignId: updatedCampaignContact.campaignId,
      contactId: updatedCampaignContact.contactId,
      campaignContactId: updatedCampaignContact.id,
      data: {
        probabilityScore: callOutcomePrediction.probabilityScore,
        bucket: callOutcomePrediction.bucket,
        action: callOutcomePrediction.recommendedAction,
        followUp: callOutcomePrediction.recommendedFollowUp,
        confidence: callOutcomePrediction.confidenceLevel,
      },
    };
    
    // Log in dev mode only
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] CALL_OUTCOME_PREDICTED payload:', JSON.stringify(outcomePredictedEvent, null, 2));
    }
    
    eventBus.emit('event', outcomePredictedEvent);

    // Emit CALL_CONTEXT_UPDATED SSE event for simple emotion/urgency detection
    if (emotionAndUrgency) {
      const contextUpdatedEvent: SSEEvent = {
        type: 'CALL_CONTEXT_UPDATED',
        campaignId: updatedCampaignContact.campaignId,
        contactId: updatedCampaignContact.contactId,
        campaignContactId: updatedCampaignContact.id,
        data: {
          // Map 'hesitant' to 'anxious' for SSE event compatibility
          emotion: (emotionAndUrgency.emotion === 'hesitant' ? 'anxious' : emotionAndUrgency.emotion) as any,
          urgencyLevel: emotionAndUrgency.urgencyLevel,
        },
      };
      
      // Log in dev mode only
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] CALL_CONTEXT_UPDATED payload:', JSON.stringify(contextUpdatedEvent, null, 2));
      }
      
      eventBus.emit('event', contextUpdatedEvent);
    }

    // Emit CALL_CONTEXT_UPDATED SSE event for context-aware detection (if available)
    if (emotionUrgencyContext) {
      const contextUpdatedEvent: SSEEvent = {
        type: 'CALL_CONTEXT_UPDATED',
        campaignId: updatedCampaignContact.campaignId,
        contactId: updatedCampaignContact.contactId,
        campaignContactId: updatedCampaignContact.id,
        data: {
          // Map 'hesitant' to 'anxious' for SSE event compatibility
          emotion: (emotionUrgencyContext.emotion === 'hesitant' ? 'anxious' : emotionUrgencyContext.emotion) as any,
          urgencyLevel: emotionUrgencyContext.urgencyLevel,
          scriptMode: emotionUrgencyContext.scriptMode as any,
        },
      };
      
      // Log in dev mode only
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] CALL_CONTEXT_UPDATED (context-aware) payload:', JSON.stringify(contextUpdatedEvent, null, 2));
      }
      
      eventBus.emit('event', contextUpdatedEvent);
    }

    // Emit VOICE_STRATEGY_UPDATED SSE event for simple voice strategy decision
    if (voiceStrategyDecision) {
      const voiceStrategyUpdatedEvent: SSEEvent = {
        type: 'VOICE_STRATEGY_UPDATED',
        campaignId: updatedCampaignContact.campaignId,
        contactId: updatedCampaignContact.contactId,
        campaignContactId: updatedCampaignContact.id,
        data: {
          voiceTone: voiceStrategyDecision.voiceTone,
          speechRate: voiceStrategyDecision.speechRate,
          scriptVariant: voiceStrategyDecision.scriptVariant,
        },
      };
      
      // Log in dev mode only
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] VOICE_STRATEGY_UPDATED payload:', JSON.stringify(voiceStrategyUpdatedEvent, null, 2));
      }
      
      eventBus.emit('event', voiceStrategyUpdatedEvent);
    }

    // Emit VOICE_STRATEGY_UPDATED SSE event for context-aware decision (if available)
    if (voiceScriptDecision) {
      const voiceStrategyUpdatedEvent: SSEEvent = {
        type: 'VOICE_STRATEGY_UPDATED',
        campaignId: updatedCampaignContact.campaignId,
        contactId: updatedCampaignContact.contactId,
        campaignContactId: updatedCampaignContact.id,
        data: {
          voiceTone: voiceScriptDecision.voiceTone,
          speechRate: voiceScriptDecision.speechRate,
          scriptVariant: voiceScriptDecision.scriptVariant,
          language: voiceScriptDecision.language,
        },
      };
      
      // Log in dev mode only
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] VOICE_STRATEGY_UPDATED (context-aware) payload:', JSON.stringify(voiceStrategyUpdatedEvent, null, 2));
      }
      
      eventBus.emit('event', voiceStrategyUpdatedEvent);
    }

    // Emit ADAPTIVE_STEP_UPDATED SSE event
    if (adaptiveStepDecision) {
      const adaptiveStepUpdatedEvent: SSEEvent = {
        type: 'ADAPTIVE_STEP_UPDATED',
        campaignId: updatedCampaignContact.campaignId,
        contactId: updatedCampaignContact.contactId,
        campaignContactId: updatedCampaignContact.id,
        data: {
          // Store adaptive script mode as string (not in scriptMode field to avoid type conflict)
          nextPromptInstruction: adaptiveStepDecision.nextPromptInstruction,
          slowDownSpeech: adaptiveStepDecision.slowDownSpeech,
          interruptAllowed: adaptiveStepDecision.interruptAllowed,
          confidenceBoost: adaptiveStepDecision.confidenceBoost,
          // Add scriptMode as a custom field for adaptive step (will be handled by frontend)
          scriptMode: adaptiveStepDecision.nextScriptMode as any,
        },
      };
      
      // Log in dev mode only
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] ADAPTIVE_STEP_UPDATED payload:', JSON.stringify(adaptiveStepUpdatedEvent, null, 2));
      }
      
      eventBus.emit('event', adaptiveStepUpdatedEvent);
    }

    // 8) Call Outcome Learning Loop
    // Record successful patterns and suggest optimized strategies
    let learningStrategyApplied = false;
    let optimizedStrategy: {
      recommendedScriptMode?: string;
      recommendedVoiceTone?: string;
      recommendedSpeechRate?: string;
    } = {};
    
    try {
      // Record pattern if outcome is HIGH or VERY_HIGH (successful)
      if (callOutcomePrediction.bucket === 'HIGH' || callOutcomePrediction.bucket === 'VERY_HIGH') {
        if (emotionAndUrgency && voiceStrategyDecision && adaptiveStepDecision) {
          recordCallOutcomePattern({
            id: callLog.id,
            outcomeBucket: callOutcomePrediction.bucket,
            emotion: emotionAndUrgency.emotion,
            urgencyLevel: emotionAndUrgency.urgencyLevel,
            objections: conversationMemory.objections.map(obj => typeof obj === 'string' ? obj : String(obj)),
            scriptMode: adaptiveStepDecision.nextScriptMode,
            voiceTone: voiceStrategyDecision.voiceTone,
            speechRate: voiceStrategyDecision.speechRate,
            success: true,
          });
        }
      }
      
      // Suggest optimized strategy based on historical patterns
      if (emotionAndUrgency && conversationMemory) {
        optimizedStrategy = suggestOptimizedStrategy({
          emotion: emotionAndUrgency.emotion,
          urgencyLevel: emotionAndUrgency.urgencyLevel,
          objections: conversationMemory.objections.map(obj => typeof obj === 'string' ? obj : String(obj)),
        });
        
        // If we have recommendations, mark as applied
        if (optimizedStrategy.recommendedScriptMode || 
            optimizedStrategy.recommendedVoiceTone || 
            optimizedStrategy.recommendedSpeechRate) {
          learningStrategyApplied = true;
        }
      }
    } catch (err) {
      // If learning fails, continue without it (backward compatibility)
      console.error('[CallOutcomeLearning] Error in learning loop:', err);
    }

    // Emit LEARNING_STRATEGY_APPLIED SSE event if strategy was suggested
    if (learningStrategyApplied && optimizedStrategy) {
      const learningStrategyData: any = {
        basedOn: 'historical_success',
      };
      
      // Only include defined recommendations
      if (optimizedStrategy.recommendedScriptMode) {
        learningStrategyData.recommendedScriptMode = optimizedStrategy.recommendedScriptMode;
      }
      if (optimizedStrategy.recommendedVoiceTone) {
        learningStrategyData.recommendedVoiceTone = optimizedStrategy.recommendedVoiceTone;
      }
      if (optimizedStrategy.recommendedSpeechRate) {
        learningStrategyData.recommendedSpeechRate = optimizedStrategy.recommendedSpeechRate;
      }
      
      const learningStrategyEvent: SSEEvent = {
        type: 'LEARNING_STRATEGY_APPLIED',
        campaignId: updatedCampaignContact.campaignId,
        contactId: updatedCampaignContact.contactId,
        campaignContactId: updatedCampaignContact.id,
        data: learningStrategyData,
      };
      
      // Log in dev mode only
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] LEARNING_STRATEGY_APPLIED payload:', JSON.stringify(learningStrategyEvent, null, 2));
      }
      
      eventBus.emit('event', learningStrategyEvent);
    }

    // STEP 24: Emit CALL_SELF_REVIEW_READY SSE event if self-review was generated
    if (selfReview) {
      const selfReviewEvent: SSEEvent = {
        type: 'CALL_SELF_REVIEW_READY',
        campaignId: updatedCampaignContact.campaignId,
        contactId: updatedCampaignContact.contactId,
        campaignContactId: updatedCampaignContact.id,
        data: {
          callLogId: updatedCallLog.id,
          selfReview: selfReview,
        },
      };

      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] CALL_SELF_REVIEW_READY payload:', JSON.stringify(selfReviewEvent, null, 2));
      }

      eventBus.emit('event', selfReviewEvent);
    }

    res.json({
      ok: true,
      status,
      callLog: updatedCallLog,
      campaignContact: updatedCampaignContact,
      callOutcomePrediction,
      ...(selfReview && { selfReview }), // Include self-review in response
    });
  } catch (err: any) {
    console.error("Debug apply-score error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to apply score",
      details: String(err?.message || err),
    });
  }
});
// GET /campaigns
app.get("/campaigns", async (req: Request, res: Response) => {
  try {
    console.log("[DIAGNOSTIC] GET /campaigns - Starting database query...");
    const campaigns = await prisma.campaign.findMany({
      select: { id: true, name: true, propertyId: true },
      orderBy: { createdAt: "desc" },
    });
    console.log("[DIAGNOSTIC] GET /campaigns - Prisma result (raw campaigns):", JSON.stringify(campaigns, null, 2));
    console.log("[DIAGNOSTIC] GET /campaigns - Campaign count from database:", campaigns.length);

    // Get lead counts for each campaign using aggregation
    const campaignsWithCounts = await Promise.all(
      campaigns.map(async (campaign: any) => {
        // Aggregate lead counts by status
        const [totalResult, warmResult, hotResult] = await Promise.all([
          prisma.campaignContact.count({
            where: { campaignId: campaign.id },
          }),
          prisma.campaignContact.count({
            where: { 
              campaignId: campaign.id,
              status: 'WARM',
            },
          }),
          prisma.campaignContact.count({
            where: { 
              campaignId: campaign.id,
              status: 'HOT',
            },
          }),
        ]);

        return {
          ...campaign,
          totalLeads: totalResult || 0,
          warmLeadsCount: warmResult || 0,
          hotLeadsCount: hotResult || 0,
        };
      })
    );

    console.log("[DIAGNOSTIC] GET /campaigns - Final response data (with counts):", JSON.stringify(campaignsWithCounts, null, 2));
    console.log("[DIAGNOSTIC] GET /campaigns - Sending response: { campaigns: [...] }");
    res.json({ campaigns: campaignsWithCounts });
  } catch (err: any) {
    console.error("GET /campaigns error:", err);
    
    // Check for database connection errors
    if (err?.code === 'P1001') {
      return res.status(503).json({ 
        ok: false, 
        error: "Database connection failed",
        message: "Cannot reach database server. Check if Supabase project is active and DATABASE_URL is correct.",
        code: err.code
      });
    }
    
    res.status(500).json({ ok: false, error: "Failed to load campaigns", details: err?.message });
  }
});

// POST /campaigns/transcribe-audio - Transcribe audio file
app.post("/campaigns/transcribe-audio", upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "Audio file is required",
      });
    }

    // Mock transcription for now (in production, use OpenAI Whisper or similar)
    // For now, return a mock transcript
    const mockTranscript = "This is a premium property located in downtown area. The price range is 1.2 to 2.5 crores. It has swimming pool, gym, and clubhouse. Possession is ready to move. Ideal for families looking for luxury living. Common objections include price concerns and location queries.";
    
    // Mock language detection (in production, use language detection API)
    const detectedLanguage = 'en'; // Could be 'en', 'hi', or 'hinglish'

    res.json({
      ok: true,
      transcript: mockTranscript,
      language: detectedLanguage,
      note: "Mock transcription - replace with actual transcription service in production",
    });
  } catch (err: any) {
    console.error("POST /campaigns/transcribe-audio error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to transcribe audio",
      details: String(err?.message || err),
    });
  }
});

// POST /campaigns/generate-knowledge - Generate structured knowledge from transcript
app.post("/campaigns/generate-knowledge", async (req: Request, res: Response) => {
  try {
    const { transcript } = req.body as {
      transcript: string;
    };

    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Transcript is required",
      });
    }

    // Generate structured knowledge from transcript using AI
    // For now, use mock structured extraction (in production, use OpenAI to extract structured data)
    const structuredKnowledge = {
      safeTalkingPoints: [
        "Premium property in downtown area",
        "Price range: 1.2 to 2.5 crores",
        "Amenities: Swimming pool, gym, clubhouse",
        "Ready to move possession",
        "Ideal for families seeking luxury living",
      ],
      idealBuyerProfile: "Families looking for luxury living in premium downtown location",
      objectionsLikely: ["PRICE", "LOCATION"],
      pricingConfidence: "MEDIUM" as 'LOW' | 'MEDIUM' | 'HIGH',
      doNotSay: [
        "Guaranteed returns",
        "Investment opportunity",
        "Limited time offer",
      ],
    };

    // In production, use OpenAI to extract structured knowledge:
    // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // const completion = await openai.chat.completions.create({
    //   model: 'gpt-4',
    //   messages: [{
    //     role: 'system',
    //     content: 'Extract structured knowledge from this property description transcript...'
    //   }, {
    //     role: 'user',
    //     content: transcript
    //   }]
    // });

    res.json({
      ok: true,
      knowledge: structuredKnowledge,
      note: "Mock knowledge extraction - replace with actual AI extraction in production",
    });
  } catch (err: any) {
    console.error("POST /campaigns/generate-knowledge error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to generate knowledge",
      details: String(err?.message || err),
    });
  }
});

// POST /campaigns - Create new campaign
app.post("/campaigns", async (req: Request, res: Response) => {
  try {
    const { 
      name, 
      propertyId, 
      callerIdentityMode, 
      callerDisplayName, 
      campaignKnowledge,
      voiceTranscript,
      voiceTranscriptLanguage,
      voiceKnowledge,
      knowledgeUsageMode,
    } = req.body as {
      name: string;
      propertyId?: string | null;
      callerIdentityMode?: 'GENERIC' | 'PERSONALIZED';
      callerDisplayName?: string | null;
      campaignKnowledge?: {
        priceRange?: string;
        amenities?: string[];
        location?: string;
        possession?: string;
        highlights?: string[];
      } | null;
      voiceTranscript?: string | null;
      voiceTranscriptLanguage?: 'en' | 'hi' | 'hinglish' | null;
      voiceKnowledge?: {
        safeTalkingPoints?: string[];
        idealBuyerProfile?: string;
        objectionsLikely?: string[];
        pricingConfidence?: 'LOW' | 'MEDIUM' | 'HIGH';
        doNotSay?: string[];
      } | null;
      knowledgeUsageMode?: 'INTERNAL_ONLY' | 'PUBLIC';
    };

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Campaign name is required",
      });
    }

    // Validate caller identity mode
    const identityMode = callerIdentityMode || 'GENERIC';
    if (identityMode !== 'GENERIC' && identityMode !== 'PERSONALIZED') {
      return res.status(400).json({
        ok: false,
        error: "callerIdentityMode must be 'GENERIC' or 'PERSONALIZED'",
      });
    }

    // If mode is PERSONALIZED, callerDisplayName is required
    if (identityMode === 'PERSONALIZED') {
      if (!callerDisplayName || typeof callerDisplayName !== 'string' || callerDisplayName.trim().length === 0) {
        return res.status(400).json({
          ok: false,
          error: "callerDisplayName is required when callerIdentityMode is 'PERSONALIZED'",
        });
      }
    }

    // Validate campaignKnowledge structure if provided
    if (campaignKnowledge !== undefined && campaignKnowledge !== null) {
      if (typeof campaignKnowledge !== 'object' || Array.isArray(campaignKnowledge)) {
        return res.status(400).json({
          ok: false,
          error: "campaignKnowledge must be an object",
        });
      }

      // Validate structure - only allow specific fields, no free text blobs
      const allowedFields = ['priceRange', 'amenities', 'location', 'possession', 'highlights'];
      const knowledgeKeys = Object.keys(campaignKnowledge);
      const invalidKeys = knowledgeKeys.filter(key => !allowedFields.includes(key));
      
      if (invalidKeys.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `campaignKnowledge contains invalid fields: ${invalidKeys.join(', ')}. Allowed fields: ${allowedFields.join(', ')}`,
        });
      }

      // Validate field types
      if (campaignKnowledge.priceRange !== undefined && typeof campaignKnowledge.priceRange !== 'string') {
        return res.status(400).json({
          ok: false,
          error: "campaignKnowledge.priceRange must be a string",
        });
      }
      if (campaignKnowledge.amenities !== undefined && !Array.isArray(campaignKnowledge.amenities)) {
        return res.status(400).json({
          ok: false,
          error: "campaignKnowledge.amenities must be an array",
        });
      }
      if (campaignKnowledge.location !== undefined && typeof campaignKnowledge.location !== 'string') {
        return res.status(400).json({
          ok: false,
          error: "campaignKnowledge.location must be a string",
        });
      }
      if (campaignKnowledge.possession !== undefined && typeof campaignKnowledge.possession !== 'string') {
        return res.status(400).json({
          ok: false,
          error: "campaignKnowledge.possession must be a string",
        });
      }
      if (campaignKnowledge.highlights !== undefined && !Array.isArray(campaignKnowledge.highlights)) {
        return res.status(400).json({
          ok: false,
          error: "campaignKnowledge.highlights must be an array",
        });
      }
    }

    // Validate knowledgeUsageMode if provided
    const usageMode = knowledgeUsageMode || 'INTERNAL_ONLY';
    if (usageMode !== 'INTERNAL_ONLY' && usageMode !== 'PUBLIC') {
      return res.status(400).json({
        ok: false,
        error: "knowledgeUsageMode must be 'INTERNAL_ONLY' or 'PUBLIC'",
      });
    }

    // Validate voiceKnowledge structure if provided
    if (voiceKnowledge !== undefined && voiceKnowledge !== null) {
      if (typeof voiceKnowledge !== 'object' || Array.isArray(voiceKnowledge)) {
        return res.status(400).json({
          ok: false,
          error: "voiceKnowledge must be an object",
        });
      }

      const allowedFields = ['safeTalkingPoints', 'idealBuyerProfile', 'objectionsLikely', 'pricingConfidence', 'doNotSay'];
      const knowledgeKeys = Object.keys(voiceKnowledge);
      const invalidKeys = knowledgeKeys.filter(key => !allowedFields.includes(key));
      
      if (invalidKeys.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `voiceKnowledge contains invalid fields: ${invalidKeys.join(', ')}. Allowed fields: ${allowedFields.join(', ')}`,
        });
      }

      // Validate field types
      if (voiceKnowledge.safeTalkingPoints !== undefined && !Array.isArray(voiceKnowledge.safeTalkingPoints)) {
        return res.status(400).json({
          ok: false,
          error: "voiceKnowledge.safeTalkingPoints must be an array",
        });
      }
      if (voiceKnowledge.idealBuyerProfile !== undefined && typeof voiceKnowledge.idealBuyerProfile !== 'string') {
        return res.status(400).json({
          ok: false,
          error: "voiceKnowledge.idealBuyerProfile must be a string",
        });
      }
      if (voiceKnowledge.objectionsLikely !== undefined && !Array.isArray(voiceKnowledge.objectionsLikely)) {
        return res.status(400).json({
          ok: false,
          error: "voiceKnowledge.objectionsLikely must be an array",
        });
      }
      if (voiceKnowledge.pricingConfidence !== undefined && !['LOW', 'MEDIUM', 'HIGH'].includes(voiceKnowledge.pricingConfidence)) {
        return res.status(400).json({
          ok: false,
          error: "voiceKnowledge.pricingConfidence must be 'LOW', 'MEDIUM', or 'HIGH'",
        });
      }
      if (voiceKnowledge.doNotSay !== undefined && !Array.isArray(voiceKnowledge.doNotSay)) {
        return res.status(400).json({
          ok: false,
          error: "voiceKnowledge.doNotSay must be an array",
        });
      }
    }

    // Validate voiceTranscriptLanguage if provided
    if (voiceTranscriptLanguage !== undefined && voiceTranscriptLanguage !== null) {
      if (!['en', 'hi', 'hinglish'].includes(voiceTranscriptLanguage)) {
        return res.status(400).json({
          ok: false,
          error: "voiceTranscriptLanguage must be 'en', 'hi', or 'hinglish'",
        });
      }
    }

    // Get first user (for now, we'll use the first user in the system)
    // In production, this would come from authentication
    const firstUser = await prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    if (!firstUser) {
      return res.status(400).json({
        ok: false,
        error: "No user found. Please create a user first.",
      });
    }

    // Validate propertyId if provided
    if (propertyId) {
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
      });

      if (!property) {
        return res.status(404).json({
          ok: false,
          error: "Property not found",
        });
      }
    }

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: name.trim(),
        userId: firstUser.id,
        propertyId: propertyId || null,
        callerIdentityMode: identityMode,
        callerDisplayName: identityMode === 'PERSONALIZED' ? callerDisplayName?.trim() || null : null,
        campaignKnowledge: campaignKnowledge || null,
        voiceTranscript: voiceTranscript?.trim() || null,
        voiceTranscriptLanguage: voiceTranscriptLanguage || null,
        voiceKnowledge: voiceKnowledge || null,
        knowledgeUsageMode: usageMode,
      } as any,
      select: {
        id: true,
        name: true,
        propertyId: true,
      },
    }) as any;

    // Emit SSE event
    const campaignCreatedEvent: SSEEvent = {
      type: 'CAMPAIGN_CREATED',
      campaignId: campaign.id,
      contactId: '',
      data: {
        name: campaign.name,
        propertyId: campaign.propertyId || null,
      },
    };
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] CAMPAIGN_CREATED payload:', JSON.stringify(campaignCreatedEvent, null, 2));
    }
    
    eventBus.emit('event', campaignCreatedEvent);

    res.json({
      ok: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        propertyId: campaign.propertyId,
        callerIdentityMode: (campaign as any).callerIdentityMode || 'GENERIC',
        callerDisplayName: (campaign as any).callerDisplayName || null,
        campaignKnowledge: (campaign as any).campaignKnowledge || null,
        voiceTranscript: (campaign as any).voiceTranscript || null,
        voiceTranscriptLanguage: (campaign as any).voiceTranscriptLanguage || null,
        voiceKnowledge: (campaign as any).voiceKnowledge || null,
        knowledgeUsageMode: (campaign as any).knowledgeUsageMode || 'INTERNAL_ONLY',
      },
    });
  } catch (err: any) {
    console.error("POST /campaigns error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to create campaign",
      details: String(err?.message || err),
    });
  }
});

// Batch Call Orchestrator endpoint
app.post("/batch/start/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    
    if (!campaignId) {
      return res.status(400).json({ ok: false, error: "campaignId is required" });
    }
    
    const {
      cooldownHours = 24,
      maxRetries = 2,
    } = req.body as {
      cooldownHours?: number;
      maxRetries?: number;
    };

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: "Campaign not found",
      });
    }

    // Load eligible campaign contacts
    // Eligible: NOT_PICK (with retry check), COLD, WARM (with cooldown check)
    // Exclude: HOT leads (will pause batch)
    const allContacts = await prisma.campaignContact.findMany({
      where: {
        campaignId,
        status: {
          in: ['NOT_PICK', 'COLD', 'WARM'],
        },
      },
      include: {
        calls: {
          where: {
            resultStatus: 'NOT_PICK',
          },
        },
      },
      orderBy: [
        { status: 'asc' }, // Process NOT_PICK first, then COLD, then WARM
        { lastCallAt: 'asc' }, // Oldest calls first
      ],
    });

    // Filter eligible leads based on safety rules
    const eligibleLeadIds: string[] = [];
    const now = Date.now();
    const cooldownMs = cooldownHours * 60 * 60 * 1000;

    for (const contact of allContacts) {
      // Check NOT_PICK retry count
      if (contact.status === 'NOT_PICK') {
        const notPickCount = contact.calls.filter((c: { resultStatus: LeadStatus | null }) => c.resultStatus === 'NOT_PICK').length;
        if (notPickCount >= maxRetries) {
          continue; // Skip - max retries reached
        }
      }

      // Check cooldown period
      if (contact.lastCallAt) {
        const hoursSinceLastCall = (now - contact.lastCallAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastCall < cooldownHours) {
          continue; // Skip - cooldown not met
        }
      }

      eligibleLeadIds.push(contact.id);
    }

    if (eligibleLeadIds.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No eligible leads found for batch calling",
        message: "All leads are either HOT, have reached max retries, or are in cooldown period",
      });
    }

    // Create batch job
    const batchJob = await prisma.batchCallJob.create({
      data: {
        campaignId,
        status: 'PENDING',
        currentIndex: 0,
        totalLeads: eligibleLeadIds.length,
        cooldownHours,
        maxRetries,
      },
    });

    // Start batch execution in background (non-blocking)
    // This allows the API to return immediately while batch runs
    executeBatchSequence(
      batchJob.id,
      campaignId,
      eligibleLeadIds,
      cooldownHours,
      maxRetries,
      0 // Start from beginning
    ).catch(err => {
      console.error('[BatchOrchestrator] Fatal error in batch sequence:', err);
    });

    res.json({
      ok: true,
      message: "Batch call job started",
      batchJobId: batchJob.id,
      totalLeads: eligibleLeadIds.length,
      cooldownHours,
      maxRetries,
    });
  } catch (err: any) {
    console.error("Batch start error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to start batch call job",
      details: String(err?.message || err),
    });
  }
});

// Pause batch job endpoint
app.post("/batch/pause/:batchJobId", async (req: Request, res: Response) => {
  try {
    const { batchJobId } = req.params;
    
    if (!batchJobId) {
      return res.status(400).json({ ok: false, error: "batchJobId is required" });
    }

    // Check if batch job exists
    const batchJob = await prisma.batchCallJob.findUnique({
      where: { id: batchJobId },
    });

    if (!batchJob) {
      return res.status(404).json({
        ok: false,
        error: "Batch job not found",
      });
    }

    if (batchJob.status !== 'RUNNING') {
      return res.status(400).json({
        ok: false,
        error: `Batch job is not running (current status: ${batchJob.status})`,
      });
    }

    // Pause the batch
    pauseBatchJob(batchJobId as string);

    // Update database
    const updated = await prisma.batchCallJob.update({
      where: { id: batchJobId as string },
      data: {
        status: 'PAUSED',
        pausedAt: new Date(),
      },
    });

    // Emit SSE event
    const batchPausedEvent: SSEEvent = {
      type: 'BATCH_PAUSED',
      campaignId: batchJob.campaignId,
      contactId: '',
      data: {
        batchJobId,
        currentIndex: updated.currentIndex,
        totalLeads: updated.totalLeads,
        reason: 'Manually paused',
      },
    };
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] BATCH_PAUSED payload:', JSON.stringify(batchPausedEvent, null, 2));
    }
    
    eventBus.emit('event', batchPausedEvent);

    res.json({
      ok: true,
      message: "Batch job paused",
      batchJobId,
    });
  } catch (err: any) {
    console.error("Batch pause error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to pause batch job",
      details: String(err?.message || err),
    });
  }
});

// Resume batch job endpoint
app.post("/batch/resume/:batchJobId", async (req: Request, res: Response) => {
  try {
    const { batchJobId } = req.params;
    
    if (!batchJobId) {
      return res.status(400).json({ ok: false, error: "batchJobId is required" });
    }

    // Check if batch job exists
    const batchJob = await prisma.batchCallJob.findUnique({
      where: { id: batchJobId },
    });

    if (!batchJob) {
      return res.status(404).json({
        ok: false,
        error: "Batch job not found",
      });
    }

    if (batchJob.status !== 'PAUSED') {
      return res.status(400).json({
        ok: false,
        error: `Batch job is not paused (current status: ${batchJob.status})`,
      });
    }

    // Get resume data
    const resumeData = await resumeBatchJob(batchJobId as string);
    if (!resumeData) {
      return res.status(400).json({
        ok: false,
        error: "Failed to prepare batch job for resume",
      });
    }

    // Update database
    const updated = await prisma.batchCallJob.update({
      where: { id: batchJobId as string },
      data: {
        status: 'RUNNING',
        pausedAt: null,
      },
    });

    // Emit SSE event
    const batchResumedEvent: SSEEvent = {
      type: 'BATCH_RESUMED',
      campaignId: batchJob.campaignId,
      contactId: '',
      data: {
        batchJobId,
        currentIndex: updated.currentIndex,
        totalLeads: updated.totalLeads,
      },
    };
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] BATCH_RESUMED payload:', JSON.stringify(batchResumedEvent, null, 2));
    }
    
    eventBus.emit('event', batchResumedEvent);

    // Resume execution from currentIndex
    // Find the position in the eligibleLeadIds array that corresponds to currentIndex
    // We need to continue from where we left off in the original eligible leads list
    // Since we're resuming, we should start from the lead at position startIndex in the eligible list
    const remainingLeadIds = resumeData.leadIds.slice(resumeData.startIndex);
    
    // Continue execution in background (pass startIndex to preserve absolute position for progress tracking)
    executeBatchSequence(
      batchJobId,
      resumeData.campaignId,
      remainingLeadIds,
      resumeData.cooldownHours,
      resumeData.maxRetries,
      resumeData.startIndex // Pass startIndex to preserve absolute position for progress tracking
    ).catch(err => {
      console.error('[BatchOrchestrator] Fatal error resuming batch sequence:', err);
    });

    res.json({
      ok: true,
      message: "Batch job resumed",
      batchJobId,
      currentIndex: updated.currentIndex,
    });
  } catch (err: any) {
    console.error("Batch resume error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to resume batch job",
      details: String(err?.message || err),
    });
  }
});

// Stop batch job endpoint (human override)
app.post("/batch/stop/:batchJobId", async (req: Request, res: Response) => {
  try {
    const { batchJobId } = req.params;
    
    if (!batchJobId) {
      return res.status(400).json({ ok: false, error: "batchJobId is required" });
    }
    
    const { cancelledBy } = req.body as { cancelledBy?: string };

    // Check if batch job exists
    const batchJob = await prisma.batchCallJob.findUnique({
      where: { id: batchJobId },
    });

    if (!batchJob) {
      return res.status(404).json({
        ok: false,
        error: "Batch job not found",
      });
    }

    if (batchJob.status === 'COMPLETED' || batchJob.status === 'CANCELLED') {
      return res.status(400).json({
        ok: false,
        error: "Batch job is already completed or cancelled",
      });
    }

    // Stop the batch
    stopBatchJob(batchJobId as string, cancelledBy);

    res.json({
      ok: true,
      message: "Batch job stopped",
      batchJobId: batchJobId as string,
    });
  } catch (err: any) {
    console.error("Batch stop error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to stop batch job",
      details: String(err?.message || err),
    });
  }
});

// POST /leads/:campaignContactId/convert
// Mark a lead as converted and record learning pattern
app.post("/leads/:campaignContactId/convert", async (req: Request, res: Response) => {
  try {
    const { campaignContactId } = req.params;
    
    if (!campaignContactId) {
      return res.status(400).json({ ok: false, error: "campaignContactId is required" });
    }

    // Get campaign contact with related data
    const campaignContact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
      include: {
        calls: {
          orderBy: { startedAt: 'desc' },
          take: 1, // Get most recent call
        },
      },
    });

    if (!campaignContact) {
      return res.status(404).json({
        ok: false,
        error: "CampaignContact not found",
      });
    }

    // Mark as converted
    const updated = await prisma.campaignContact.update({
      where: { id: campaignContactId },
      data: {
        isConverted: true,
        convertedAt: new Date(),
        status: 'HOT', // Mark as HOT when converted
      },
    });

    // Record outcome pattern from most recent call
    const mostRecentCall = campaignContact.calls[0];
    if (mostRecentCall) {
      await recordOutcomePattern(
        {
          id: mostRecentCall.id,
          campaignContactId: campaignContact.id,
          scriptVariant: mostRecentCall.scriptVariant,
          voiceTone: mostRecentCall.voiceTone,
          emotion: mostRecentCall.emotion,
          urgencyLevel: mostRecentCall.urgencyLevel,
          outcomeBucket: mostRecentCall.outcomeBucket,
        },
        {
          id: campaignContact.id,
          campaignId: campaignContact.campaignId,
          objections: campaignContact.objections,
          isConverted: true,
        }
      );
    }

    res.json({
      ok: true,
      message: "Lead marked as converted",
      campaignContactId: campaignContactId as string,
      convertedAt: updated.convertedAt,
    });
  } catch (err: any) {
    console.error("Convert lead error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to convert lead",
      details: String(err?.message || err),
    });
  }
});

// GET /learning/patterns/:campaignId
// Get top performing patterns for a campaign
app.get("/learning/patterns/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    
    if (!campaignId) {
      return res.status(400).json({ ok: false, error: "campaignId is required" });
    }

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: "Campaign not found",
      });
    }

    // Get top patterns
    const patterns = await getTopPatterns(campaignId as string);

    res.json({
      ok: true,
      campaignId: campaignId as string,
      patterns,
      count: patterns.length,
    });
  } catch (err: any) {
    console.error("Get learning patterns error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to get learning patterns",
      details: String(err?.message || err),
    });
  }
});

// GET /campaigns/:id/contacts
app.get("/campaigns/:id/contacts", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ ok: false, error: "id is required" });
    }
    
    const contacts = await prisma.campaignContact.findMany({
      where: { campaignId: id as string },
      include: { contact: true },
      orderBy: { lastCallAt: "desc" },
    });
    res.json({ contacts });
  } catch (err) {
    console.error("GET /campaigns/:id/contacts error:", err);
    res.status(500).json({ ok: false, error: "Failed to load contacts" });
  }
});

// POST /call/live/transcript - STEP 23: Receive transcript chunk for live monitoring
app.post("/call/live/transcript", async (req: Request, res: Response) => {
  try {
    const { callLogId, transcriptChunk, campaignContactId, campaignId, contactId } = req.body as {
      callLogId?: string;
      transcriptChunk?: string;
      campaignContactId?: string;
      campaignId?: string;
      contactId?: string;
    };

    if (!callLogId || !transcriptChunk) {
      return res.status(400).json({
        ok: false,
        error: "callLogId and transcriptChunk are required",
      });
    }

    if (!campaignContactId || !campaignId || !contactId) {
      return res.status(400).json({
        ok: false,
        error: "campaignContactId, campaignId, and contactId are required",
      });
    }

    // Process transcript chunk through live monitor
    processLiveTranscriptChunk(
      callLogId,
      transcriptChunk,
      campaignContactId,
      campaignId,
      contactId
    );

    res.json({
      ok: true,
      message: "Transcript chunk processed",
    });
  } catch (err: any) {
    console.error("Live transcript processing error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to process transcript chunk",
      details: String(err?.message || err),
    });
  }
});

// POST /call/live/emergency/stop - STEP 23: Emergency stop call
app.post("/call/live/emergency/stop", async (req: Request, res: Response) => {
  try {
    const { callLogId } = req.body as { callLogId?: string };

    if (!callLogId) {
      return res.status(400).json({
        ok: false,
        error: "callLogId is required",
      });
    }

    // Find call log
    const callLog = await prisma.callLog.findUnique({
      where: { id: callLogId },
      include: {
        campaignContact: {
          include: { campaign: true },
        },
      },
    });

    if (!callLog) {
      return res.status(404).json({
        ok: false,
        error: "CallLog not found",
      });
    }

    // End live monitoring
    endLiveMonitoring(callLogId);

    // Update call log to mark as ended
    await prisma.callLog.update({
      where: { id: callLogId },
      data: {
        endedAt: new Date(),
        resultStatus: callLog.campaignContact.status,
      },
    });

    // Emit CALL_ENDED event
    const callEndedEventData: any = {
      callLogId: callLog.id,
      resultStatus: callLog.campaignContact.status,
      emergencyStop: true,
    };
    
    if (callLog.twilioCallSid) {
      callEndedEventData.callSid = callLog.twilioCallSid;
    }
    
    const callEndedEvent: SSEEvent = {
      type: 'CALL_ENDED',
      campaignId: callLog.campaignContact.campaignId,
      contactId: callLog.campaignContact.contactId,
      campaignContactId: callLog.campaignContactId,
      data: callEndedEventData,
    };

    eventBus.emit('event', callEndedEvent);

    res.json({
      ok: true,
      message: "Call stopped successfully",
    });
  } catch (err: any) {
    console.error("Emergency stop error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to stop call",
      details: String(err?.message || err),
    });
  }
});

// POST /call/live/emergency/handoff - STEP 23: Force human handoff
app.post("/call/live/emergency/handoff", async (req: Request, res: Response) => {
  try {
    const { callLogId } = req.body as { callLogId?: string };

    if (!callLogId) {
      return res.status(400).json({
        ok: false,
        error: "callLogId is required",
      });
    }

    // Find call log and campaign contact
    const callLog = await prisma.callLog.findUnique({
      where: { id: callLogId },
      include: {
        campaignContact: true,
      },
    });

    if (!callLog) {
      return res.status(404).json({
        ok: false,
        error: "CallLog not found",
      });
    }

    // Update campaign contact to recommend handoff
    await prisma.campaignContact.update({
      where: { id: callLog.campaignContactId },
      data: {
        handoffRecommended: true,
        handoffReason: 'Emergency human handoff requested by supervisor',
      },
    });

    // Emit SSE event for handoff
    const handoffEvent: SSEEvent = {
      type: 'HUMAN_OVERRIDE_APPLIED',
      campaignId: callLog.campaignContact.campaignId,
      contactId: callLog.campaignContact.contactId,
      campaignContactId: callLog.campaignContactId,
      data: {
        forceHandoff: true,
        handoffReason: 'Emergency human handoff requested',
        callLogId: callLog.id,
      },
    };

    eventBus.emit('event', handoffEvent);

    res.json({
      ok: true,
      message: "Human handoff requested",
      handoffRecommended: true,
    });
  } catch (err: any) {
    console.error("Emergency handoff error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to request handoff",
      details: String(err?.message || err),
    });
  }
});

// GET /call/live/status/:callLogId - STEP 23: Get live call status
app.get("/call/live/status/:callLogId", async (req: Request, res: Response) => {
  try {
    const { callLogId } = req.params;
    
    if (!callLogId) {
      return res.status(400).json({ ok: false, error: "callLogId is required" });
    }

    const callState = getLiveCallState(callLogId as string);

    if (!callState) {
      return res.status(404).json({
        ok: false,
        error: "Call is not live or not found",
      });
    }

    res.json({
      ok: true,
      isLive: true,
      transcriptSummary: callState.fullTranscript.length > 200 
        ? callState.fullTranscript.slice(-200) + '...'
        : callState.fullTranscript,
      emotion: callState.emotion,
      urgencyLevel: callState.urgencyLevel,
      objections: callState.detectedObjections,
      riskLevel: callState.riskLevel,
      suggestions: callState.suggestions,
      lastUpdateAt: callState.lastUpdateAt.toISOString(),
    });
  } catch (err: any) {
    console.error("Get live status error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to get live status",
      details: String(err?.message || err),
    });
  }
});

// GET /call/:callLogId/review - STEP 24: Get call self-review
app.get("/call/:callLogId/review", async (req: Request, res: Response) => {
  try {
    const { callLogId } = req.params;
    
    if (!callLogId) {
      return res.status(400).json({ ok: false, error: "callLogId is required" });
    }

    const callLog = await prisma.callLog.findUnique({
      where: { id: callLogId },
      include: {
        campaignContact: {
          include: {
            contact: true,
            campaign: true,
          },
        },
      },
    }) as any;

    if (!callLog) {
      return res.status(404).json({
        ok: false,
        error: "CallLog not found",
      });
    }

    // Get self-review from CallLog (stored as JSON)
    const selfReview = callLog.aiSelfReview;

    if (!selfReview) {
      return res.status(404).json({
        ok: false,
        error: "Self-review not available for this call",
      });
    }

    res.json({
      ok: true,
      callLogId: callLog.id,
      selfReview,
    });
  } catch (err: any) {
    console.error("Get call review error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to get call review",
      details: String(err?.message || err),
    });
  }
});

// GET /call/preview/:campaignContactId - STEP 22: Pre-Call Simulation Preview
app.get("/call/preview/:campaignContactId", async (req: Request, res: Response) => {
  try {
    const { campaignContactId } = req.params;
    
    if (!campaignContactId) {
      return res.status(400).json({ ok: false, error: "campaignContactId is required" });
    }

    const campaignContact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
      include: { 
        contact: true,
        campaign: {
          include: {
            property: true,
          },
        },
      },
    }) as any;

    if (!campaignContact) {
      return res.status(404).json({ ok: false, error: "CampaignContact not found" });
    }

    // STEP 22: Assemble call context (same logic as /call/start but without making a call)
    // 1. Determine script mode from lead status
    const scriptMode = getScriptModeFromLeadStatus(campaignContact.status);

    // 2. Get caller identity
    const campaign = campaignContact?.campaign as any;
    const callerIdentity = (campaign?.callerIdentityMode === 'PERSONALIZED') ? 'PERSONALIZED' : 'GENERIC';
    const callerName = campaign?.callerDisplayName || undefined;
    const preferredLanguage = campaignContact.preferredLanguage as "en" | "hi" | "hinglish" | undefined || "en";

    // 3. Generate opening line
    const openingLine = getOpeningLine({
      scriptMode,
      callerIdentity: callerIdentity as "GENERIC" | "PERSONALIZED",
      callerName,
      language: preferredLanguage,
    });

    // 4. Check for human override (highest priority)
    const extraContext = (campaignContact as any).extraContext;
    const humanOverride = extraContext && typeof extraContext === 'object' ? extraContext : null;
    const hasHumanOverride = humanOverride && humanOverride.overrideStrategy === true;

    // 5. Get auto-applied strategy (if enabled and no override)
    let autoAppliedStrategy: AutoApplyStrategyResult | null = null;
    if (!hasHumanOverride && campaign?.autoStrategyEnabled === true) {
      try {
        autoAppliedStrategy = await selectBestStrategyForAutoApply(campaignContact.campaignId);
      } catch (err: any) {
        // Graceful degradation
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[Preview] Error selecting best strategy:', err);
        }
      }
    }

    // 6. Get adaptive strategy
    const strategyContext: AdaptiveStrategyContext = {
      campaignId: campaignContact.campaignId,
      leadStatus: campaignContact.status,
      emotion: autoAppliedStrategy?.emotion || null,
      urgencyLevel: autoAppliedStrategy?.urgencyLevel || null,
      objections: campaignContact.objections || [],
    };
    
    const adaptiveStrategy = await selectAdaptiveStrategy(strategyContext);

    // 7. Determine final strategy values (priority: human override > auto-applied > adaptive > defaults)
    const finalScriptVariant = humanOverride?.scriptVariant || autoAppliedStrategy?.scriptVariant || adaptiveStrategy.scriptVariant;
    const finalVoiceTone = humanOverride?.voiceTone || autoAppliedStrategy?.voiceTone || adaptiveStrategy.voiceTone;
    const finalEmotion = humanOverride?.emotion || autoAppliedStrategy?.emotion || null;
    const finalUrgencyLevel = humanOverride?.urgencyLevel || autoAppliedStrategy?.urgencyLevel || null;
    const finalSpeechRate = humanOverride?.speechRate || adaptiveStrategy.speechRate;

    // 8. Get campaign knowledge
    const campaignKnowledge = campaign?.campaignKnowledge as {
      priceRange?: string;
      amenities?: string[];
      location?: string;
      possession?: string;
      highlights?: string[];
    } | null || null;

    // 9. Generate pitch points
    const mainPitch = getMainPitchPoints({
      scriptMode,
      campaignKnowledge,
      language: preferredLanguage,
    });

    // 10. Generate closing line
    const closingLine = getClosingLine({
      scriptMode,
      language: preferredLanguage,
    });

    // 11. Build preview response
    res.json({
      ok: true,
      language: preferredLanguage,
      voiceTone: finalVoiceTone,
      emotion: finalEmotion,
      urgencyLevel: finalUrgencyLevel,
      scriptVariant: finalScriptVariant,
      speechRate: finalSpeechRate,
      openingLine,
      mainPitch,
      closingLine,
      callerIdentity: {
        mode: callerIdentity,
        name: callerName || null,
      },
      scriptMode: scriptMode,
      strategySource: humanOverride ? 'HUMAN_OVERRIDE' : (autoAppliedStrategy ? 'AUTO_APPLIED' : 'ADAPTIVE'),
    });
  } catch (err: any) {
    console.error("Call preview error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to generate call preview",
      details: String(err?.message || err),
    });
  }
});

// GET /campaign-contact/:id/script-mode - Get ScriptMode for a campaign contact (STEP 20)
app.get("/campaign-contact/:id/script-mode", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ ok: false, error: "id is required" });
    }
    
    const campaignContact = await prisma.campaignContact.findUnique({
      where: { id: id as string },
      include: { campaign: true },
    });

    if (!campaignContact) {
      return res.status(404).json({ ok: false, error: "CampaignContact not found" });
    }

    const scriptMode = getScriptModeFromLeadStatus(campaignContact.status);
    const campaign = (campaignContact as { campaign: any }).campaign;
    const callerIdentity = (campaign?.callerIdentityMode === 'PERSONALIZED') ? 'PERSONALIZED' : 'GENERIC';
    const callerName = campaign?.callerDisplayName || undefined;
    const preferredLanguage = campaignContact.preferredLanguage as "en" | "hi" | "hinglish" | undefined || "en";

    const openingLine = getOpeningLine({
      scriptMode,
      callerIdentity: callerIdentity as "GENERIC" | "PERSONALIZED",
      callerName,
      language: preferredLanguage,
    });

    const probingQuestions = getProbingQuestions(scriptMode);

    res.json({
      ok: true,
      scriptMode,
      openingLine,
      probingQuestions,
      leadStatus: campaignContact.status,
    });
  } catch (err: any) {
    console.error("GET /campaign-contact/:id/script-mode error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to get script mode",
      details: String(err?.message || err),
    });
  }
});

// GET /analytics/overview/:campaignId
app.get("/analytics/overview/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    
    if (!campaignId) {
      return res.status(400).json({ ok: false, error: "campaignId is required" });
    }

    // Get campaign contacts
    const contacts = await prisma.campaignContact.findMany({
      where: { campaignId: campaignId as string },
      include: {
        calls: {
          select: {
            id: true,
            durationSeconds: true,
            startedAt: true,
            endedAt: true,
          },
        },
      },
    });

    // Calculate KPIs
    const totalCalls = contacts.reduce((sum: number, cc: any) => sum + cc.calls.length, 0);
    const hotLeads = contacts.filter((cc: any) => cc.status === "HOT").length;
    const convertedLeads = contacts.filter((cc: any) => (cc as any).isConverted === true).length;
    const conversionRate = contacts.length > 0 ? (convertedLeads / contacts.length) * 100 : 0;

    // Calculate average call duration
    const allDurations = contacts.flatMap((cc: any) =>
      cc.calls
        .map((call: { durationSeconds: number | null }) => call.durationSeconds)
        .filter((d: any): d is number => d !== null && d !== undefined)
    );
    const avgCallDuration =
      allDurations.length > 0
        ? Math.round(allDurations.reduce((sum: number, d: number) => sum + d, 0) / allDurations.length)
        : 0;

    // Funnel data
    const funnelData = {
      NOT_PICK: contacts.filter((cc: any) => cc.status === "NOT_PICK").length,
      COLD: contacts.filter((cc: any) => cc.status === "COLD").length,
      WARM: contacts.filter((cc: any) => cc.status === "WARM").length,
      HOT: contacts.filter((cc: any) => cc.status === "HOT").length,
      CONVERTED: convertedLeads,
    };

    // Batch Performance (recent batch jobs)
    const batchJobs = await prisma.batchCallJob.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        currentIndex: true,
        totalLeads: true,
        startedAt: true,
        completedAt: true,
        cancelledAt: true,
        createdAt: true,
      },
    });

    // AI Learning Insights (top 3 OutcomeLearningPattern)
    const topPatterns = await prisma.outcomeLearningPattern.findMany({
      where: {
        campaignId,
        converted: true,
      },
      orderBy: { createdAt: "desc" },
      take: 3,
    });

    res.json({
      ok: true,
      kpis: {
        totalCalls,
        hotLeads,
        conversionRate: Math.round(conversionRate * 100) / 100,
        avgCallDuration,
      },
      funnel: funnelData,
      batchPerformance: batchJobs,
      aiLearningInsights: topPatterns,
    });
  } catch (err: any) {
    console.error("GET /analytics/overview/:campaignId error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to load analytics",
      details: err?.message || "Unknown error",
    });
  }
});

// Helper function to get human override from campaign contact
// Uses type assertion to access extraContext field (may not exist in schema yet)
function getHumanOverride(campaignContact: any): any {
  try {
    // Use type assertion to access extraContext (stored as JSON)
    // Note: This field may not exist in schema yet - will work once field is added
    const extraContext = (campaignContact as any).extraContext;
    if (extraContext && typeof extraContext === 'object' && extraContext.humanOverride) {
      return extraContext.humanOverride;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Helper function to set human override in campaign contact
// Uses type assertion to store in extraContext field (may not exist in schema yet)
function setHumanOverride(overrideData: any): any {
  // Store in extraContext.humanOverride using type assertion
  // Note: This requires extraContext JSON field in CampaignContact schema
  // For now, using type assertion - will work once field is added
  return {
    extraContext: {
      humanOverride: overrideData,
    },
  } as any;
}

// Human Override endpoint - Allow sales agents to override AI decisions
// Supports comprehensive override actions for real-time control
app.post("/leads/:campaignContactId/override", async (req: Request, res: Response) => {
  try {
    const { campaignContactId } = req.params;
    
    if (!campaignContactId) {
      return res.status(400).json({ ok: false, error: "campaignContactId is required" });
    }
    
    const {
      // AI strategy overrides
      scriptMode,
      scriptVariant,
      voiceTone,
      speechRate,
      // Follow-up overrides
      followUpChannel,
      followUpAfterHours,
      followUpMessageIntent,
      // Status and handoff overrides
      status,
      forceHandoff,
      // Batch and call control
      stopBatch,
      stopCurrentCall,
      // STEP 21: Auto-strategy override flag
      overrideStrategy,
      // Metadata
      overrideReason,
      overriddenBy,
    } = req.body as {
      scriptMode?: string;
      scriptVariant?: string;
      voiceTone?: string;
      speechRate?: string;
      followUpChannel?: string;
      followUpAfterHours?: number;
      followUpMessageIntent?: string;
      status?: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
      forceHandoff?: boolean;
      stopBatch?: boolean;
      stopCurrentCall?: boolean;
      overrideStrategy?: boolean; // STEP 21: Disable auto-strategy for this lead
      overrideReason?: string;
      overriddenBy?: string;
    };

    // Validate campaign contact exists
    const campaignContact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
      include: {
        calls: {
          where: {
            endedAt: null, // Active calls only
          },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!campaignContact) {
      return res.status(404).json({
        ok: false,
        error: "CampaignContact not found",
      });
    }

    // Handle stopCurrentCall: End active call if ongoing
    if (stopCurrentCall === true) {
      const activeCall = campaignContact.calls[0];
      if (activeCall && activeCall.twilioCallSid) {
        try {
          // Update call log to mark as ended
          await prisma.callLog.update({
            where: { id: activeCall.id },
            data: {
              endedAt: new Date(),
              resultStatus: status || campaignContact.status,
            },
          });

          // Emit CALL_ENDED event
          const callEndedEventData: any = {
            status: status || campaignContact.status,
            callLogId: activeCall.id,
            resultStatus: status || campaignContact.status,
          };
          
          if (activeCall.twilioCallSid) {
            callEndedEventData.callSid = activeCall.twilioCallSid;
          }
          
          const callEndedEvent: SSEEvent = {
            type: 'CALL_ENDED',
            campaignId: campaignContact.campaignId,
            contactId: campaignContact.contactId,
            campaignContactId: campaignContact.id,
            data: callEndedEventData,
          };
          
          if (process.env.NODE_ENV !== 'production') {
            console.log('[SSE] CALL_ENDED (human override) payload:', JSON.stringify(callEndedEvent, null, 2));
          }
          
          eventBus.emit('event', callEndedEvent);
        } catch (err: any) {
          console.error('[HumanOverride] Error ending call:', err);
          // Continue with override even if call end fails
        }
      }
    }

    // Handle stopBatch: Cancel active batch jobs
    if (stopBatch === true) {
      const activeBatchJobs = await prisma.batchCallJob.findMany({
        where: {
          campaignId: campaignContact.campaignId,
          status: 'RUNNING',
        },
      });
      
      for (const batchJob of activeBatchJobs) {
        stopBatchJob(batchJob.id, overriddenBy);
        
        // Emit BATCH_CANCELLED event
        const batchCancelledEvent: SSEEvent = {
          type: 'BATCH_CANCELLED',
          campaignId: campaignContact.campaignId,
          contactId: '',
          data: {
            batchJobId: batchJob.id,
            currentIndex: batchJob.currentIndex,
            totalLeads: batchJob.totalLeads,
            reason: `Human override: ${overrideReason || 'Batch stopped by operator'}`,
          },
        };
        
        if (process.env.NODE_ENV !== 'production') {
          console.log('[SSE] BATCH_CANCELLED (human override) payload:', JSON.stringify(batchCancelledEvent, null, 2));
        }
        
        eventBus.emit('event', batchCancelledEvent);
      }
    }

    // Get existing override or create new one
    const existingOverride = getHumanOverride(campaignContact) || {};
    
    // Build override object
    const humanOverride: any = {
      ...existingOverride,
      overriddenAt: new Date().toISOString(),
    };

    // Update override fields (only if provided)
    if (scriptMode !== undefined) {
      humanOverride.scriptMode = scriptMode;
    }
    if (scriptVariant !== undefined) {
      humanOverride.scriptVariant = scriptVariant;
    }
    if (voiceTone !== undefined) {
      humanOverride.voiceTone = voiceTone;
    }
    if (speechRate !== undefined) {
      humanOverride.speechRate = speechRate;
    }
    if (followUpChannel !== undefined) {
      humanOverride.followUpChannel = followUpChannel;
    }
    if (followUpAfterHours !== undefined) {
      humanOverride.followUpAfterHours = followUpAfterHours;
    }
    if (followUpMessageIntent !== undefined) {
      humanOverride.followUpMessageIntent = followUpMessageIntent;
    }
    if (status !== undefined) {
      humanOverride.status = status;
    }
    if (forceHandoff !== undefined) {
      humanOverride.forceHandoff = forceHandoff;
    }
    if (stopBatch !== undefined) {
      humanOverride.stopBatch = stopBatch;
    }
    if (stopCurrentCall !== undefined) {
      humanOverride.stopCurrentCall = stopCurrentCall;
    }
    // STEP 21: Handle overrideStrategy flag (disables auto-strategy for this lead)
    if (overrideStrategy !== undefined) {
      humanOverride.overrideStrategy = overrideStrategy;
    }
    if (overrideReason !== undefined) {
      humanOverride.overrideReason = overrideReason;
    }
    if (overriddenBy !== undefined) {
      humanOverride.overriddenBy = overriddenBy;
    }

    // Update campaign contact with override (using type assertion for backward compatibility)
    // Note: This requires extraContext JSON field in CampaignContact schema
    // For now, using type assertion - will work once field is added, or gracefully fail
    const updateData: any = setHumanOverride(humanOverride);
    
    let updatedCampaignContact;
    try {
      updatedCampaignContact = await prisma.campaignContact.update({
        where: { id: campaignContactId },
        data: updateData,
      });
    } catch (err: any) {
      // If extraContext field doesn't exist, return error
      if (err?.code === 'P2009' || err?.message?.includes('Unknown field') || err?.message?.includes('extraContext')) {
        return res.status(400).json({
          ok: false,
          error: "extraContext field not available in schema",
          message: "Please add extraContext JSON field to CampaignContact model to enable human overrides",
        });
      }
      throw err;
    }

    // Emit SSE event for human override
    const humanOverrideEvent: SSEEvent = {
      type: 'HUMAN_OVERRIDE_APPLIED',
      campaignId: updatedCampaignContact.campaignId,
      contactId: updatedCampaignContact.contactId,
      campaignContactId: updatedCampaignContact.id,
      data: {
        overrides: humanOverride,
        overriddenBy: humanOverride.overriddenBy,
      },
    };
    
    // Log in dev mode only
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] HUMAN_OVERRIDE_APPLIED payload:', JSON.stringify(humanOverrideEvent, null, 2));
    }
    
    eventBus.emit('event', humanOverrideEvent);

    res.json({
      ok: true,
      message: "Human override applied successfully",
      override: humanOverride,
      campaignContact: updatedCampaignContact,
    });
  } catch (err: any) {
    console.error("Human override error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to apply human override",
      details: String(err?.message || err),
    });
  }
});

// POST /leads/upload-csv/:campaignId - Bulk CSV lead upload
app.post("/leads/upload-csv/:campaignId", upload.single('csv'), async (req: Request, res: Response) => {
  console.log('[CSV UPLOAD] Request received');
  try {
    const { campaignId } = req.params;
    const file = req.file;

    if (!campaignId) {
      return res.status(400).json({
        ok: false,
        error: "Campaign ID is required",
      });
    }

    if (!file) {
      return res.status(400).json({
        ok: false,
        error: "CSV file is required",
      });
    }

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: "Campaign not found",
      });
    }

    const userId = campaign.userId;
    const uploadBatchId = `batch-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Parse CSV file
    let records: any[];
    try {
      const csvContent = file.buffer.toString('utf-8');
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (parseError: any) {
      return res.status(400).json({
        ok: false,
        error: "Failed to parse CSV file",
        details: parseError?.message || String(parseError),
      });
    }

    if (records.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "CSV file is empty or has no valid rows",
      });
    }

    // Validate CSV headers (case-insensitive, trimmed)
    const requiredHeaders = ['name', 'phone'];
    const firstRow = records[0] || {};
    const headers = Object.keys(firstRow).map(h => h.trim().toLowerCase());
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h.toLowerCase()));
    
    if (missingHeaders.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `Missing required CSV headers: ${missingHeaders.join(', ')}`,
        foundHeaders: Object.keys(firstRow),
      });
    }

    // Helper function to normalize Indian phone numbers to E.164
    function normalizePhoneToE164(phone: string): string | null {
      // Remove spaces, commas, hyphens, parentheses
      let cleaned = phone.replace(/[\s,\-()]/g, '');
      
      // Remove leading + if present
      if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1);
      }
      
      // If 10 digits (Indian mobile), prefix with +91
      if (/^[6-9]\d{9}$/.test(cleaned)) {
        return `+91${cleaned}`;
      }
      
      // If 11 digits starting with 0 (Indian landline), remove 0 and prefix +91
      if (/^0[6-9]\d{9}$/.test(cleaned)) {
        return `+91${cleaned.substring(1)}`;
      }
      
      // If already in E.164 format (starts with +), validate
      if (cleaned.startsWith('91') && cleaned.length === 12) {
        return `+${cleaned}`;
      }
      
      // If already starts with +, return as is (will validate later)
      if (phone.trim().startsWith('+')) {
        return phone.trim();
      }
      
      return null;
    }

    // Validate phone number format (E.164)
    const e164Regex = /^\+[1-9]\d{1,14}$/;

    // Process each row
    const summary = {
      totalRows: records.length,
      created: 0,
      duplicates: 0,
      invalidRows: 0,
    };

    const createdCampaignContactIds: string[] = [];

    for (const row of records) {
      // Get values with case-insensitive header matching
      const nameKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'name') || 'name';
      const phoneKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'phone') || 'phone';
      const sourceKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'source') || 'source';
      
      const name = (row[nameKey] || '').trim();
      const phoneRaw = (row[phoneKey] || '').trim();
      const source = (row[sourceKey] || 'CSV').trim();

      // Validate required fields
      if (!name || !phoneRaw) {
        summary.invalidRows++;
        continue;
      }

      // Normalize phone number (handle Indian numbers)
      const phone = normalizePhoneToE164(phoneRaw);
      
      // Validate phone format
      if (!phone || !e164Regex.test(phone)) {
        summary.invalidRows++;
        continue;
      }

      // Check for duplicate lead by phone within the same campaign
      const existingContact = await prisma.contact.findFirst({
        where: {
          phone: phone,
          userId: userId,
        },
        include: {
          campaigns: {
            where: {
              campaignId: campaignId,
            },
          },
        },
      });

      // If contact exists and is already linked to this campaign, skip as duplicate
      if (existingContact && 'campaigns' in existingContact && Array.isArray(existingContact.campaigns) && existingContact.campaigns.length > 0) {
        summary.duplicates++;
        continue;
      }

      // Create or get Contact
      let contact;
      if (existingContact) {
        // Contact exists but not linked to this campaign
        contact = existingContact;
      } else {
        // Create new Contact
        contact = await prisma.contact.create({
          data: {
            userId: userId,
            name: name,
            phone: phone,
            source: source,
          },
        });
      }

      // Create CampaignContact
      // Use type assertion for extraContext (backward compatibility)
      const campaignContact = await prisma.campaignContact.create({
        data: {
          campaignId: campaignId,
          contactId: contact.id,
          status: 'NOT_PICK',
          // Store upload batch ID in extraContext (using type assertion for backward compatibility)
          extraContext: {
            uploadBatchId: uploadBatchId,
            retryMetadata: {
              retryCount: 0,
              lastAttemptedAt: null,
              lastRetryReason: null,
            },
          } as any,
        },
      });

      createdCampaignContactIds.push(campaignContact.id);
      summary.created++;

      // Emit LEAD_CREATED SSE event for each successful lead
      const leadCreatedEvent: SSEEvent = {
        type: 'LEAD_CREATED',
        campaignId: campaignId,
        contactId: contact.id,
        campaignContactId: campaignContact.id,
        data: {
          name: name,
          phone: phone,
          source: source || 'CSV',
        },
      };
      
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] LEAD_CREATED (CSV upload) payload:', JSON.stringify(leadCreatedEvent, null, 2));
      }
      
      eventBus.emit('event', leadCreatedEvent);
    }

    res.json({
      ok: true,
      message: "CSV upload completed",
      totalRows: summary.totalRows,
      created: summary.created,
      duplicates: summary.duplicates,
      invalidRows: summary.invalidRows,
      uploadBatchId: uploadBatchId,
    });
  } catch (err: any) {
    console.error("CSV upload error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to upload CSV",
      details: String(err?.message || err),
    });
  }
});

// POST /leads/create - Manual lead entry
app.post("/leads/create", async (req: Request, res: Response) => {
  try {
    const { campaignId, name, phone, source = "MANUAL" } = req.body as {
      campaignId: string;
      name: string;
      phone: string;
      source?: string;
    };

    // Validate required fields
    if (!campaignId || !name || !phone) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: campaignId, name, and phone are required",
      });
    }

    // Validate phone number in E.164 format (starts with +, followed by country code and number)
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    if (!e164Regex.test(phone)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid phone number format. Must be in E.164 format (e.g., +919876543210)",
      });
    }

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: "Campaign not found",
      });
    }

    // Get userId from campaign (needed for Contact creation)
    const userId = campaign.userId;

    // Check for duplicate lead by phone within the same campaign
    const existingContact = await prisma.contact.findFirst({
      where: {
        phone: phone,
        userId: userId,
      },
      include: {
        campaigns: {
          where: {
            campaignId: campaignId as string,
          },
        },
      },
    });

    // If contact exists and is already linked to this campaign, return existing CampaignContact
    if (existingContact && existingContact.campaigns.length > 0) {
      const existingCampaignContact = existingContact.campaigns[0];
      
      if (!existingCampaignContact) {
        // This should not happen, but handle gracefully
        return res.status(500).json({
          ok: false,
          error: "Unexpected error: campaign contact not found",
        });
      }
      
      // Emit LEAD_CREATED event for existing lead (for UI consistency)
      const leadCreatedEvent: SSEEvent = {
        type: 'LEAD_CREATED',
        campaignId: campaignId,
        contactId: existingContact.id,
        campaignContactId: existingCampaignContact.id,
        data: {
          name: existingContact.name,
          phone: existingContact.phone,
          source: source,
        },
      };
      
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] LEAD_CREATED (existing) payload:', JSON.stringify(leadCreatedEvent, null, 2));
      }
      
      eventBus.emit('event', leadCreatedEvent);

      return res.json({
        ok: true,
        message: "Lead already exists in this campaign",
        campaignContactId: existingCampaignContact.id,
        contactId: existingContact.id,
        isDuplicate: true,
      });
    }

    // Create or update Contact
    let contact;
    if (existingContact) {
      // Contact exists but not linked to this campaign - update if needed
      contact = existingContact;
    } else {
      // Create new Contact
      contact = await prisma.contact.create({
        data: {
          userId: userId,
          name: name,
          phone: phone,
          source: source,
        },
      });
    }

    // Create CampaignContact with status = NOT_PICK
    // Store retry metadata in extraContext (using type assertion for backward compatibility)
    const campaignContact = await prisma.campaignContact.create({
      data: {
        campaignId: campaignId as string,
        contactId: contact.id,
        status: 'NOT_PICK',
        // Initialize retry metadata in extraContext
        extraContext: {
          retryMetadata: {
            retryCount: 0,
            lastAttemptedAt: null,
            lastRetryReason: null,
          },
        },
      },
    });

    // Emit SSE event
    const leadCreatedEvent: SSEEvent = {
      type: 'LEAD_CREATED',
      campaignId: campaignId,
      contactId: contact.id,
      campaignContactId: campaignContact.id,
      data: {
        name: name,
        phone: phone,
        source: source,
      },
    };
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] LEAD_CREATED payload:', JSON.stringify(leadCreatedEvent, null, 2));
    }
    
    eventBus.emit('event', leadCreatedEvent);

    res.json({
      ok: true,
      message: "Lead created successfully",
      campaignContactId: campaignContact.id,
      contactId: contact.id,
      campaignId: campaignId,
    });
  } catch (err: any) {
    console.error("Create lead error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to create lead",
      details: String(err?.message || err),
    });
  }
});

// Remove human override endpoint
app.delete("/leads/:campaignContactId/override", async (req: Request, res: Response) => {
  try {
    const { campaignContactId } = req.params;
    
    if (!campaignContactId) {
      return res.status(400).json({ ok: false, error: "campaignContactId is required" });
    }

    const campaignContact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
    });

    if (!campaignContact) {
      return res.status(404).json({
        ok: false,
        error: "CampaignContact not found",
      });
    }

    // Remove override by setting extraContext to null or empty
    const updateData: any = {
      extraContext: null,
    };
    
    let updatedCampaignContact;
    try {
      updatedCampaignContact = await prisma.campaignContact.update({
        where: { id: campaignContactId },
        data: updateData,
      });
    } catch (err: any) {
      // If extraContext field doesn't exist, return error
      if (err?.code === 'P2009' || err?.message?.includes('Unknown field') || err?.message?.includes('extraContext')) {
        return res.status(400).json({
          ok: false,
          error: "extraContext field not available in schema",
          message: "Please add extraContext JSON field to CampaignContact model to enable human overrides",
        });
      }
      throw err;
    }

    res.json({
      ok: true,
      message: "Human override removed successfully",
      campaignContact: updatedCampaignContact,
    });
  } catch (err: any) {
    console.error("Remove override error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to remove human override",
      details: String(err?.message || err),
    });
  }
});

// Mark lead as converted and capture successful patterns for AI learning
app.post("/leads/:campaignContactId/convert", async (req: Request, res: Response) => {
  try {
    const { campaignContactId } = req.params;
    
    if (!campaignContactId) {
      return res.status(400).json({ ok: false, error: "campaignContactId is required" });
    }
    
    // Find the campaign contact
    const campaignContact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
      include: {
        calls: {
          orderBy: { startedAt: "asc" },
        },
      },
    });
    
    if (!campaignContact) {
      return res.status(404).json({
        ok: false,
        error: "CampaignContact not found",
      });
    }
    
    // Mark as converted
    // Handle backward compatibility: use type assertion for new fields that may not exist in Prisma client yet
    const campaignContactData: any = {
      isConverted: true,
      convertedAt: new Date(),
    };
    const updatedCampaignContact: any = await prisma.campaignContact.update({
      where: { id: campaignContactId },
      data: campaignContactData,
    });
    
    // Capture successful patterns for AI learning
    // This extracts patterns from the conversion journey for future ML training
    const campaignContactAny = campaignContact as any;
    const conversationMemory = {
      questions: (campaignContactAny.lastQuestionsAsked as string[] | undefined) || [],
      objections: (campaignContactAny.objections as string[] | undefined) || [],
      sentiment: "positive" as const, // Assumed positive if converted
      preferredLanguage: campaignContactAny.preferredLanguage || undefined,
    };
    
    // Extract patterns from all calls in the conversion journey
    const patternId = await captureSuccessfulPatterns(
      campaignContactId as string,
      campaignContact.calls.map((call: { id: string; transcript: string | null; durationSeconds: number | null; resultStatus: LeadStatus | null }) => ({
        id: call.id,
        transcript: call.transcript,
        durationSeconds: call.durationSeconds,
        resultStatus: call.resultStatus,
      })),
      conversationMemory
    );
    
    // TODO: Future - Trigger model training when enough patterns are collected
    // For now, just capture the pattern
    // In future: if (patternCount >= MIN_PATTERNS_FOR_TRAINING) { await learnFromSuccessfulCalls(); }
    
    res.json({
      ok: true,
      message: "Lead marked as converted",
      campaignContactId: updatedCampaignContact.id,
      convertedAt: updatedCampaignContact.convertedAt,
      patternCaptured: patternId !== null,
      patternId: patternId,
      note: "Successful patterns captured for future AI learning. ML training not yet implemented.",
    });
  } catch (err: any) {
    console.error("Convert lead error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to mark lead as converted",
      details: String(err?.message || err),
    });
  }
});
