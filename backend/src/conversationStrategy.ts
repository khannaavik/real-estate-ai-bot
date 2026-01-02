// backend/src/conversationStrategy.ts
// Conversation Strategy Engine - Rule-based script mode selection and opening lines

import type { LeadStatus } from "@prisma/client";

/**
 * Script mode enum for conversation strategy.
 * Determines the overall approach and tone of the conversation.
 */
export enum ScriptMode {
  INTRO = "INTRO",           // First contact, no prior interaction
  DISCOVERY = "DISCOVERY",   // Exploring needs and interests
  QUALIFICATION = "QUALIFICATION", // Assessing fit and readiness
  CLOSING = "CLOSING",       // Moving toward commitment
  FOLLOW_UP = "FOLLOW_UP",  // Subsequent contact after initial interaction
}

/**
 * Get script mode from lead status.
 * Deterministic mapping based on lead status.
 * 
 * @param status - Current lead status
 * @returns ScriptMode corresponding to the lead status
 */
export function getScriptModeFromLeadStatus(status: LeadStatus): ScriptMode {
  switch (status) {
    case "NOT_PICK":
      return ScriptMode.INTRO;
    case "COLD":
      return ScriptMode.DISCOVERY;
    case "WARM":
      return ScriptMode.QUALIFICATION;
    case "HOT":
      return ScriptMode.CLOSING;
    default:
      // Fallback to INTRO for unknown statuses
      return ScriptMode.INTRO;
  }
}

/**
 * Options for generating opening line.
 */
export interface OpeningLineOptions {
  scriptMode: ScriptMode;
  callerIdentity: "GENERIC" | "PERSONALIZED";
  callerName?: string; // Required if callerIdentity is "PERSONALIZED"
  language?: "en" | "hi" | "hinglish"; // Default: "en"
}

/**
 * Get opening line based on script mode and caller identity.
 * Returns personalized or generic opening based on campaign settings.
 * 
 * @param options - Configuration for opening line generation
 * @returns Opening line string
 */
export function getOpeningLine(options: OpeningLineOptions): string {
  const { scriptMode, callerIdentity, callerName, language = "en" } = options;

  // Build caller introduction part
  let callerIntro: string;
  if (callerIdentity === "PERSONALIZED" && callerName) {
    callerIntro = `This is an automated call on behalf of ${callerName}. `;
  } else {
    callerIntro = "This is an automated call regarding a property inquiry. ";
  }

  // Build script mode-specific opening based on language
  let modeOpening: string;

  if (language === "hi") {
    // Hindi openings
    switch (scriptMode) {
      case ScriptMode.INTRO:
        modeOpening = "मैं आपसे एक प्रॉपर्टी के बारे में बात करना चाहता हूं। ";
        break;
      case ScriptMode.DISCOVERY:
        modeOpening = "मैं आपकी रुचि के बारे में जानना चाहता हूं। ";
        break;
      case ScriptMode.QUALIFICATION:
        modeOpening = "आपकी पिछली बातचीत के आधार पर, मैं आपकी आवश्यकताओं को समझना चाहता हूं। ";
        break;
      case ScriptMode.CLOSING:
        modeOpening = "आपकी रुचि देखकर, मैं आपको अगले कदम के बारे में बताना चाहता हूं। ";
        break;
      case ScriptMode.FOLLOW_UP:
        modeOpening = "पिछली बातचीत के बाद, मैं आपसे फिर से जुड़ना चाहता हूं। ";
        break;
      default:
        modeOpening = "मैं आपसे एक प्रॉपर्टी के बारे में बात करना चाहता हूं। ";
    }
  } else if (language === "hinglish") {
    // Hinglish (Hindi-English mix) openings
    switch (scriptMode) {
      case ScriptMode.INTRO:
        modeOpening = "Main aapko ek property ke baare mein baat karna chahta hoon. ";
        break;
      case ScriptMode.DISCOVERY:
        modeOpening = "Main aapki interest ke baare mein jaan na chahta hoon. ";
        break;
      case ScriptMode.QUALIFICATION:
        modeOpening = "Aapki pichli baat-chit ke aadhaar par, main aapki zarooraton ko samajhna chahta hoon. ";
        break;
      case ScriptMode.CLOSING:
        modeOpening = "Aapki interest dekh kar, main aapko agle kadam ke baare mein batana chahta hoon. ";
        break;
      case ScriptMode.FOLLOW_UP:
        modeOpening = "Pichli baat-chit ke baad, main aapse phir se jodna chahta hoon. ";
        break;
      default:
        modeOpening = "Main aapko ek property ke baare mein baat karna chahta hoon. ";
    }
  } else {
    // English openings (default)
    switch (scriptMode) {
      case ScriptMode.INTRO:
        modeOpening = "I'm calling to introduce you to a property opportunity. ";
        break;
      case ScriptMode.DISCOVERY:
        modeOpening = "I'd like to learn more about your property interests. ";
        break;
      case ScriptMode.QUALIFICATION:
        modeOpening = "Based on our previous conversation, I'd like to understand your requirements better. ";
        break;
      case ScriptMode.CLOSING:
        modeOpening = "Given your interest, I'd like to discuss the next steps with you. ";
        break;
      case ScriptMode.FOLLOW_UP:
        modeOpening = "Following up on our previous conversation, I wanted to reconnect with you. ";
        break;
      default:
        modeOpening = "I'm calling to introduce you to a property opportunity. ";
    }
  }

  return callerIntro + modeOpening;
}

/**
 * Get probing questions for a specific script mode.
 * These questions help guide the conversation based on the current stage.
 * 
 * @param scriptMode - Current script mode
 * @returns Array of probing questions appropriate for the script mode
 */
export function getProbingQuestions(scriptMode: ScriptMode): string[] {
  switch (scriptMode) {
    case ScriptMode.INTRO:
      return [
        "Are you currently looking for a property?",
        "What type of property are you interested in?",
        "What's your budget range?",
        "When are you planning to make a purchase?",
      ];

    case ScriptMode.DISCOVERY:
      return [
        "What specific features are you looking for in a property?",
        "What's your preferred location?",
        "What's your timeline for purchasing?",
        "Are you looking for a ready-to-move-in property or under-construction?",
        "What's your budget range?",
        "Do you have any specific requirements like parking, amenities, or floor preference?",
      ];

    case ScriptMode.QUALIFICATION:
      return [
        "Have you visited any properties recently?",
        "What factors are most important to you in making a decision?",
        "Are you pre-approved for a home loan?",
        "What's your preferred payment plan?",
        "Do you have any concerns or questions about the property?",
        "What would help you make a decision?",
      ];

    case ScriptMode.CLOSING:
      return [
        "Would you like to schedule a site visit?",
        "Are you ready to move forward with the booking?",
        "What information do you need to make a final decision?",
        "Would you like to discuss the payment plan in detail?",
        "Is there anything holding you back from proceeding?",
      ];

    case ScriptMode.FOLLOW_UP:
      return [
        "Have you had a chance to think about our previous conversation?",
        "Do you have any new questions or concerns?",
        "Would you like to revisit any specific aspects of the property?",
        "Has anything changed in your requirements since we last spoke?",
        "Are you still interested in moving forward?",
      ];

    default:
      return [
        "Are you currently looking for a property?",
        "What type of property are you interested in?",
      ];
  }
}

/**
 * Options for generating pitch points.
 */
export interface PitchPointsOptions {
  scriptMode: ScriptMode;
  campaignKnowledge?: {
    priceRange?: string;
    amenities?: string[];
    location?: string;
    possession?: string;
    highlights?: string[];
  } | null;
  language?: "en" | "hi" | "hinglish";
}

/**
 * Get main pitch points based on script mode and campaign knowledge.
 * Returns an array of pitch points that will be used during the call.
 * 
 * @param options - Configuration for pitch point generation
 * @returns Array of pitch point strings
 */
export function getMainPitchPoints(options: PitchPointsOptions): string[] {
  const { scriptMode, campaignKnowledge, language = "en" } = options;
  const pitchPoints: string[] = [];

  // Base pitch points from campaign knowledge
  if (campaignKnowledge) {
    if (campaignKnowledge.location) {
      if (language === "hi") {
        pitchPoints.push(`स्थान: ${campaignKnowledge.location}`);
      } else if (language === "hinglish") {
        pitchPoints.push(`Location: ${campaignKnowledge.location}`);
      } else {
        pitchPoints.push(`Location: ${campaignKnowledge.location}`);
      }
    }

    if (campaignKnowledge.priceRange) {
      if (language === "hi") {
        pitchPoints.push(`मूल्य सीमा: ${campaignKnowledge.priceRange}`);
      } else if (language === "hinglish") {
        pitchPoints.push(`Price range: ${campaignKnowledge.priceRange}`);
      } else {
        pitchPoints.push(`Price range: ${campaignKnowledge.priceRange}`);
      }
    }

    if (campaignKnowledge.highlights && campaignKnowledge.highlights.length > 0) {
      const highlights = campaignKnowledge.highlights.slice(0, 2).join(", ");
      if (language === "hi") {
        pitchPoints.push(`मुख्य विशेषताएं: ${highlights}`);
      } else if (language === "hinglish") {
        pitchPoints.push(`Key features: ${highlights}`);
      } else {
        pitchPoints.push(`Key features: ${highlights}`);
      }
    }

    if (campaignKnowledge.amenities && campaignKnowledge.amenities.length > 0) {
      const amenities = campaignKnowledge.amenities.slice(0, 2).join(", ");
      if (language === "hi") {
        pitchPoints.push(`सुविधाएं: ${amenities}`);
      } else if (language === "hinglish") {
        pitchPoints.push(`Amenities: ${amenities}`);
      } else {
        pitchPoints.push(`Amenities: ${amenities}`);
      }
    }
  }

  // Add script mode-specific pitch points
  if (pitchPoints.length === 0) {
    // Fallback if no campaign knowledge
    switch (scriptMode) {
      case ScriptMode.INTRO:
        if (language === "hi") {
          pitchPoints.push("यह एक उत्कृष्ट निवेश का अवसर है");
        } else if (language === "hinglish") {
          pitchPoints.push("Yeh ek excellent investment opportunity hai");
        } else {
          pitchPoints.push("This is an excellent investment opportunity");
        }
        break;
      case ScriptMode.DISCOVERY:
        if (language === "hi") {
          pitchPoints.push("हमारे पास आपकी आवश्यकताओं के अनुरूप विकल्प हैं");
        } else if (language === "hinglish") {
          pitchPoints.push("Humare paas aapki zarooraton ke anuroop options hain");
        } else {
          pitchPoints.push("We have options that match your requirements");
        }
        break;
      case ScriptMode.QUALIFICATION:
        if (language === "hi") {
          pitchPoints.push("यह संपत्ति आपकी आवश्यकताओं के लिए उपयुक्त है");
        } else if (language === "hinglish") {
          pitchPoints.push("Yeh property aapki zarooraton ke liye upyukt hai");
        } else {
          pitchPoints.push("This property is suitable for your requirements");
        }
        break;
      case ScriptMode.CLOSING:
        if (language === "hi") {
          pitchPoints.push("अब सही समय है आगे बढ़ने का");
        } else if (language === "hinglish") {
          pitchPoints.push("Ab sahi samay hai aage badhne ka");
        } else {
          pitchPoints.push("Now is the right time to move forward");
        }
        break;
      default:
        if (language === "hi") {
          pitchPoints.push("यह एक उत्कृष्ट निवेश का अवसर है");
        } else if (language === "hinglish") {
          pitchPoints.push("Yeh ek excellent investment opportunity hai");
        } else {
          pitchPoints.push("This is an excellent investment opportunity");
        }
    }
  }

  return pitchPoints;
}

/**
 * Options for generating closing line.
 */
export interface ClosingLineOptions {
  scriptMode: ScriptMode;
  language?: "en" | "hi" | "hinglish";
}

/**
 * Get closing line based on script mode.
 * Returns a call-to-action appropriate for the conversation stage.
 * 
 * @param options - Configuration for closing line generation
 * @returns Closing line string
 */
export function getClosingLine(options: ClosingLineOptions): string {
  const { scriptMode, language = "en" } = options;

  if (language === "hi") {
    switch (scriptMode) {
      case ScriptMode.INTRO:
        return "क्या आप अधिक जानकारी चाहेंगे?";
      case ScriptMode.DISCOVERY:
        return "क्या आप विवरण साझा करना चाहेंगे?";
      case ScriptMode.QUALIFICATION:
        return "क्या आप साइट विज़िट शेड्यूल करना चाहेंगे?";
      case ScriptMode.CLOSING:
        return "क्या आप आज ही बुकिंग के साथ आगे बढ़ना चाहेंगे?";
      case ScriptMode.FOLLOW_UP:
        return "क्या आप अगले कदम पर चर्चा करना चाहेंगे?";
      default:
        return "क्या आप अधिक जानकारी चाहेंगे?";
    }
  } else if (language === "hinglish") {
    switch (scriptMode) {
      case ScriptMode.INTRO:
        return "Kya aap aur details chahenge?";
      case ScriptMode.DISCOVERY:
        return "Kya aap details share karna chahenge?";
      case ScriptMode.QUALIFICATION:
        return "Kya aap site visit schedule karna chahenge?";
      case ScriptMode.CLOSING:
        return "Kya aap aaj hi booking ke saath aage badhna chahenge?";
      case ScriptMode.FOLLOW_UP:
        return "Kya aap agle kadam par discuss karna chahenge?";
      default:
        return "Kya aap aur details chahenge?";
    }
  } else {
    // English (default)
    switch (scriptMode) {
      case ScriptMode.INTRO:
        return "Would you like to know more details?";
      case ScriptMode.DISCOVERY:
        return "Would you like me to share more details?";
      case ScriptMode.QUALIFICATION:
        return "Would you like to schedule a site visit?";
      case ScriptMode.CLOSING:
        return "Would you like to proceed with booking today?";
      case ScriptMode.FOLLOW_UP:
        return "Would you like to discuss the next steps?";
      default:
        return "Would you like to know more details?";
    }
  }
}
