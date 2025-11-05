# Emotional Intelligence Implementation Guide

This guide explains how to implement the Adaptive Context Layer that makes Lucid emotionally intelligent.

---

## 🎯 Overview

The system works in three steps:

```
1. DETECT emotional state
   └─→ Analyze Big 5 shifts + conversation patterns
   
2. ADAPT behavior
   └─→ Adjust schedules, temperature, research focus
   
3. RESPOND with empathy
   └─→ Use adapted context in chat and autonomous thinking
```

---

## Step 1: Emotional State Detection

### Detection Triggers

Lucid should check for emotional states:
1. **After every personality assessment** (when new Big 5 snapshot created)
2. **When conversation patterns are unusual** (e.g., late-night chats)
3. **Periodically** (daily emotional health check)

### Detection Logic

```typescript
// src/services/emotional-state.service.ts

interface EmotionalStateDetection {
  state: EmotionalState | null;
  reasoning: string;
  confidence: number;
}

async function detectEmotionalState(
  userId: string
): Promise<EmotionalStateDetection> {
  
  // 1. Get user's personality baseline
  const baseline = await getPersonalityStatistics(userId);
  
  // 2. Get most recent personality snapshot
  const current = await getLatestPersonalitySnapshot(userId);
  
  if (!baseline || !current) {
    return {
      state: null,
      reasoning: 'Insufficient data for detection',
      confidence: 0
    };
  }
  
  // 3. Calculate deviations from baseline (in standard deviations)
  const deviations = {
    openness: (current.openness - baseline.avg_openness) / baseline.std_openness,
    conscientiousness: (current.conscientiousness - baseline.avg_conscientiousness) / baseline.std_conscientiousness,
    extraversion: (current.extraversion - baseline.avg_extraversion) / baseline.std_extraversion,
    agreeableness: (current.agreeableness - baseline.avg_agreeableness) / baseline.std_agreeableness,
    neuroticism: (current.neuroticism - baseline.avg_neuroticism) / baseline.std_neuroticism,
  };
  
  // 4. Check for significant shifts (> 2 standard deviations)
  const SIGNIFICANT = 2.0; // 2 std dev = top 2.5% of distribution
  const MODERATE = 1.5;    // 1.5 std dev = top 7% of distribution
  
  // 5. Pattern matching for emotional states
  
  // STRUGGLING: High neuroticism + low agreeableness
  if (deviations.neuroticism > SIGNIFICANT && deviations.agreeableness < -MODERATE) {
    return {
      state: {
        state_type: 'struggling',
        confidence: Math.min(Math.abs(deviations.neuroticism) / 3, 1.0),
        trigger_type: 'personality_shift',
        indicators: {
          personality_deltas: deviations,
          reasoning: `Significant neuroticism increase (+${(deviations.neuroticism * baseline.std_neuroticism).toFixed(2)}) with decreased agreeableness`
        },
        recommended_approach: 'supportive'
      },
      reasoning: 'User showing signs of emotional distress',
      confidence: 0.85
    };
  }
  
  // ENERGIZED: High extraversion + high openness
  if (deviations.extraversion > MODERATE && deviations.openness > MODERATE) {
    return {
      state: {
        state_type: 'energized',
        confidence: Math.min(
          (Math.abs(deviations.extraversion) + Math.abs(deviations.openness)) / 6, 
          1.0
        ),
        trigger_type: 'personality_shift',
        indicators: {
          personality_deltas: deviations,
          reasoning: `Increased extraversion and openness suggest high energy and curiosity`
        },
        recommended_approach: 'exploratory'
      },
      reasoning: 'User appears energized and open to exploration',
      confidence: 0.75
    };
  }
  
  // WITHDRAWN: Low extraversion + high neuroticism
  if (deviations.extraversion < -SIGNIFICANT && deviations.neuroticism > MODERATE) {
    return {
      state: {
        state_type: 'withdrawn',
        confidence: Math.min(
          (Math.abs(deviations.extraversion) + Math.abs(deviations.neuroticism)) / 6, 
          1.0
        ),
        trigger_type: 'personality_shift',
        indicators: {
          personality_deltas: deviations,
          reasoning: `Decreased social engagement with elevated anxiety`
        },
        recommended_approach: 'minimal'
      },
      reasoning: 'User may need space and minimal intrusion',
      confidence: 0.80
    };
  }
  
  // REFLECTIVE: High openness + low extraversion, stable neuroticism
  if (
    deviations.openness > MODERATE && 
    deviations.extraversion < -MODERATE &&
    Math.abs(deviations.neuroticism) < 1.0
  ) {
    return {
      state: {
        state_type: 'reflective',
        confidence: 0.70,
        trigger_type: 'personality_shift',
        indicators: {
          personality_deltas: deviations,
          reasoning: `Increased openness with reduced social engagement, but stable mood`
        },
        recommended_approach: 'analytical'
      },
      reasoning: 'User in contemplative state',
      confidence: 0.70
    };
  }
  
  // 6. Check conversation patterns for additional evidence
  const conversationContext = await analyzeRecentConversations(userId);
  
  // Late-night conversations may indicate emotional distress
  if (conversationContext.lateNightConversations > 2 && deviations.neuroticism > 1.0) {
    return {
      state: {
        state_type: 'struggling',
        confidence: 0.75,
        trigger_type: 'conversation_pattern',
        indicators: {
          personality_deltas: deviations,
          conversation_times: conversationContext.times,
          reasoning: `Multiple late-night conversations (${conversationContext.lateNightConversations}) combined with elevated neuroticism`
        },
        recommended_approach: 'gentle'
      },
      reasoning: 'Conversation timing suggests potential distress',
      confidence: 0.70
    };
  }
  
  // No significant emotional state detected
  return {
    state: null,
    reasoning: 'No significant deviations from baseline personality',
    confidence: 0
  };
}

// Helper: Analyze recent conversation patterns
async function analyzeRecentConversations(userId: string) {
  const recentConvos = await supabase
    .from('conversations')
    .select('time_of_day, created_at')
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // last 7 days
    .order('created_at', { ascending: false });
    
  const lateNightConversations = recentConvos.data?.filter(
    c => c.time_of_day === 'late_night'
  ).length || 0;
  
  const times = recentConvos.data?.map(c => c.created_at) || [];
  
  return { lateNightConversations, times };
}
```

---

## Step 2: Context Adaptation

### Generating Adaptations

When an emotional state is detected, generate appropriate adaptations:

```typescript
// src/services/context-adaptation.service.ts

async function generateAdaptation(
  userId: string,
  emotionalState: EmotionalState
): Promise<ContextAdaptation> {
  
  const user = await getUser(userId);
  
  switch (emotionalState.state_type) {
    
    case 'struggling':
      return {
        user_id: userId,
        emotional_state_id: emotionalState.id,
        
        // Schedule adjustments
        morning_schedule: '08:00', // Later start (more rest)
        midday_schedule: 'disabled', // Skip midday (less intrusion)
        evening_schedule: '20:00', // Gentle evening check-in
        night_schedule: 'disabled', // Skip dreams (let them sleep)
        
        // Prompt adjustments
        temperature_modifier: 0.6, // More focused, less random
        tone_directive: `The user is going through a difficult time emotionally. 
                         Be gentle, supportive, and empathetic. 
                         Avoid overwhelming them with too much information or complexity.
                         Focus on understanding and validation rather than problem-solving.`,
        
        // Research strategy
        curiosity_approach: 'supportive',
        research_topics: [
          'gentle self-care strategies',
          'emotional wellbeing resources',
          'supportive practices for difficult times'
        ],
        research_avoidance: [
          'challenging topics',
          'complex problems',
          'emotionally heavy content'
        ],
        research_priority: 8, // High priority - help them
        
        // Reasoning
        adaptation_reasoning: `User showing signs of emotional distress with elevated neuroticism. 
                               Prioritizing support and gentle interaction.`,
        
        // Valid for 7 days or until state changes
        active_from: new Date(),
        active_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      };
    
    case 'energized':
      return {
        user_id: userId,
        emotional_state_id: emotionalState.id,
        
        morning_schedule: '07:00', // Early start (they're energized!)
        midday_schedule: '12:30',
        evening_schedule: '20:00',
        night_schedule: '03:00', // Extra pattern analysis
        
        temperature_modifier: 1.2, // More creative
        tone_directive: `The user is energized and curious! 
                         Be creative, exploratory, and dive deep into interesting topics.
                         Make bold connections and ask thought-provoking questions.`,
        
        curiosity_approach: 'exploratory',
        research_topics: [
          // Get top user interests
          ...(await getTopUserInterests(userId))
        ],
        research_avoidance: [],
        research_priority: 9,
        
        adaptation_reasoning: `User energized with high openness and extraversion. 
                               Maximizing exploration and creative thinking.`,
        
        active_from: new Date(),
        active_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
      };
    
    case 'withdrawn':
      return {
        user_id: userId,
        emotional_state_id: emotionalState.id,
        
        morning_schedule: 'disabled', // Respect space
        midday_schedule: 'disabled',
        evening_schedule: '21:00', // Very gentle evening check
        night_schedule: 'disabled',
        
        temperature_modifier: 0.5, // Very focused
        tone_directive: `The user appears withdrawn and may need space. 
                         Keep interactions brief, gentle, and non-intrusive.
                         Don't push for engagement - just be available.`,
        
        curiosity_approach: 'minimal',
        research_topics: [],
        research_avoidance: ['all'],
        research_priority: 2, // Very low
        
        adaptation_reasoning: `User withdrawn with low extraversion. Respecting need for space.`,
        
        active_from: new Date(),
        active_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      };
    
    case 'reflective':
      return {
        user_id: userId,
        emotional_state_id: emotionalState.id,
        
        morning_schedule: '07:30',
        midday_schedule: 'disabled', // Skip practical midday
        evening_schedule: '20:00',
        night_schedule: '03:00', // Dreams support reflection
        
        temperature_modifier: 0.9,
        tone_directive: `The user is in a reflective, contemplative state. 
                         Support deep thinking with thoughtful questions and philosophical exploration.
                         Be analytical but also wonder-filled.`,
        
        curiosity_approach: 'analytical',
        research_topics: [
          'philosophical concepts',
          'deep questions',
          'contemplative practices'
        ],
        research_avoidance: ['superficial topics'],
        research_priority: 7,
        
        adaptation_reasoning: `User in reflective state. Supporting contemplation.`,
        
        active_from: new Date(),
        active_until: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000)
      };
    
    default:
      // Stable/unknown state - use defaults
      return null;
  }
}
```

---

## Step 3: Using Adaptations

### In Chat

```typescript
// src/services/chat.service.ts

async function buildSystemPrompt(userId: string): Promise<string> {
  
  // Get memory context
  const facts = await getRelevantFacts(userId);
  const personality = await getLatestPersonality(userId);
  
  // Check for active adaptation
  const adaptation = await getActiveAdaptation(userId);
  
  let systemPrompt = `You are Lucid, an emotionally intelligent AI assistant.
  
PERSONALITY PROFILE:
${formatPersonality(personality)}

RELEVANT FACTS:
${facts.map(f => `- ${f.content} (confidence: ${f.confidence})`).join('\n')}
`;

  // Inject adaptation if exists
  if (adaptation) {
    systemPrompt += `\n
EMOTIONAL CONTEXT:
The user is currently in a "${adaptation.emotional_state.state_type}" state.

${adaptation.tone_directive}
`;
  }
  
  return systemPrompt;
}

async function getChatTemperature(userId: string): Promise<number> {
  const adaptation = await getActiveAdaptation(userId);
  
  const baseTemperature = 0.7;
  
  if (adaptation) {
    return baseTemperature * adaptation.temperature_modifier;
  }
  
  return baseTemperature;
}
```

### In Autonomous Agents

```typescript
// src/services/circadian-agents.service.ts

async function shouldRunAgent(
  userId: string,
  agentType: 'morning' | 'midday' | 'evening' | 'night'
): Promise<boolean> {
  
  const adaptation = await getActiveAdaptation(userId);
  
  if (!adaptation) {
    return true; // No adaptation, run normally
  }
  
  // Check if this agent is disabled
  const scheduleField = `${agentType}_schedule`;
  const schedule = adaptation[scheduleField];
  
  if (schedule === 'disabled') {
    logger.info(`Skipping ${agentType} agent for user ${userId} due to adaptation`);
    return false;
  }
  
  return true;
}

async function buildAgentPrompt(
  userId: string,
  agentType: 'morning' | 'midday' | 'evening' | 'night'
): Promise<{ prompt: string; temperature: number }> {
  
  const basePrompts = {
    morning: `You are Lucid in morning reflection mode...`,
    midday: `You are Lucid being curious...`,
    evening: `You are Lucid consolidating the day...`,
    night: `You are Lucid in a dream-like state...`
  };
  
  let prompt = basePrompts[agentType];
  let temperature = 0.7;
  
  // Get adaptation
  const adaptation = await getActiveAdaptation(userId);
  
  if (adaptation) {
    // Append emotional context
    prompt += `\n\n${adaptation.tone_directive}`;
    temperature *= adaptation.temperature_modifier;
  }
  
  return { prompt, temperature };
}
```

### In Curiosity Engine

```typescript
// src/services/curiosity-engine.service.ts

async function generateResearchTasks(userId: string): Promise<ResearchTask[]> {
  
  const adaptation = await getActiveAdaptation(userId);
  
  if (!adaptation) {
    // Default: explore user's top interests
    return generateDefaultResearchTasks(userId);
  }
  
  switch (adaptation.curiosity_approach) {
    case 'minimal':
      // Don't research anything
      return [];
    
    case 'supportive':
      // Research gentle, helpful resources
      return adaptation.research_topics.map(topic => ({
        user_id: userId,
        emotional_state_id: adaptation.emotional_state_id,
        query: topic,
        purpose: 'Provide supportive resources for user during difficult time',
        approach: 'gentle',
        priority: adaptation.research_priority
      }));
    
    case 'exploratory':
      // Deep dive on user interests
      const interests = await getTopUserInterests(userId, 5);
      return interests.map(interest => ({
        user_id: userId,
        query: interest,
        purpose: 'Explore user interests in depth',
        approach: 'exploratory',
        priority: adaptation.research_priority
      }));
    
    case 'analytical':
      // Research deeper, philosophical topics
      return adaptation.research_topics.map(topic => ({
        user_id: userId,
        query: topic,
        purpose: 'Support contemplative thinking',
        approach: 'analytical',
        priority: adaptation.research_priority
      }));
    
    default:
      return generateDefaultResearchTasks(userId);
  }
}
```

---

## Testing Emotional Intelligence

### Test Scenarios

**Scenario 1: Struggling State**
1. Create user with baseline personality
2. Insert conversation with high neuroticism indicators
3. Generate personality snapshot (high neuroticism)
4. Trigger emotional state detection
5. Verify "struggling" state detected
6. Check adaptation created with:
   - Supportive tone
   - Reduced temperature
   - Gentle research topics
   - Adjusted schedules

**Scenario 2: State Resolution**
1. User in "struggling" state
2. New conversation with normalized personality
3. Generate new personality snapshot (back to baseline)
4. Trigger detection again
5. Verify state marked as resolved
6. Check adaptation expired

**Scenario 3: Chat with Adaptation**
1. User in "energized" state
2. Send chat message
3. Verify system prompt includes:
   - Emotional context
   - Tone directive
   - Temperature adjusted (higher)

---

## Monitoring & Iteration

### Key Metrics to Track

1. **Detection Accuracy**: Do detected states match user reality?
2. **Adaptation Helpfulness**: Do users respond positively to adapted behavior?
3. **False Positives**: Are we detecting states that don't exist?
4. **False Negatives**: Are we missing obvious emotional states?

### Feedback Mechanisms

- Let users confirm/deny detected states
- Track conversation quality after adaptations
- Monitor if users disengage when adapted behavior is active
- A/B test: adapted vs non-adapted conversations

---

## Next Steps

1. **Implement detection logic** in `EmotionalStateService`
2. **Create adaptation generation** in `ContextAdaptationService`
3. **Wire up to personality assessment** (trigger detection after each snapshot)
4. **Test with synthetic data** (simulate personality shifts)
5. **Integrate with chat and agents**
6. **Monitor and iterate** based on real usage

---

This system makes Lucid genuinely emotionally intelligent - not just responsive, but adaptive and empathetic. 🧠💙
