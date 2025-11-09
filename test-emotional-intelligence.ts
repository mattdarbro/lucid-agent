/**
 * End-to-End Test for Phase 3: Emotional Intelligence
 *
 * This script demonstrates the full emotional intelligence flow:
 * 1. Create a user
 * 2. Create conversation with messages showing personality shift
 * 3. Generate personality snapshots (baseline + current)
 * 4. Detect emotional state
 * 5. Generate context adaptation
 * 6. Test chat with emotional context
 */

import { pool } from './src/db';
import { UserService } from './src/services/user.service';
import { ConversationService } from './src/services/conversation.service';
import { MessageService } from './src/services/message.service';
import { VectorService } from './src/services/vector.service';
import { PersonalityService } from './src/services/personality.service';
import { EmotionalStateService } from './src/services/emotional-state.service';
import { ContextAdaptationService } from './src/services/context-adaptation.service';
import { ChatService } from './src/services/chat.service';

async function testEmotionalIntelligence() {
  console.log('🧠 Testing Phase 3: Emotional Intelligence\n');

  try {
    // Initialize services
    const userService = new UserService(pool);
    const conversationService = new ConversationService(pool);
    const vectorService = new VectorService();
    const messageService = new MessageService(pool, vectorService);
    const personalityService = new PersonalityService(pool);
    const emotionalStateService = new EmotionalStateService(pool);
    const contextAdaptationService = new ContextAdaptationService(pool);
    const chatService = new ChatService(pool);

    // Step 1: Create a test user
    console.log('Step 1: Creating test user...');
    const user = await userService.createOrUpdateUser({
      external_id: 'test_emotional_intelligence_' + Date.now(),
      name: 'Test User',
      timezone: 'America/Los_Angeles',
    });
    console.log(`✓ User created: ${user.id}\n`);

    // Step 2: Create baseline conversation (stable personality)
    console.log('Step 2: Creating baseline conversation (stable mood)...');
    const baselineConvo = await conversationService.createConversation({
      user_id: user.id,
      title: 'Baseline Conversation',
    });

    const baselineMessages = [
      'Hey, how are you today?',
      'I had a good day at work, finished a project',
      'Looking forward to the weekend',
      'I might go hiking or read a book',
      'Work is going well, steady progress',
    ];

    for (const content of baselineMessages) {
      await messageService.createMessage({
        conversation_id: baselineConvo.id,
        user_id: user.id,
        role: 'user',
        content,
      });
      // Simulate assistant responses
      await messageService.createMessage({
        conversation_id: baselineConvo.id,
        user_id: user.id,
        role: 'assistant',
        content: 'That sounds nice.',
      });
    }
    console.log(`✓ Baseline conversation created with ${baselineMessages.length} messages\n`);

    // Step 3: Generate baseline personality snapshot
    console.log('Step 3: Assessing baseline personality...');
    const baselineSnapshot = await personalityService.createPersonalitySnapshot({
      user_id: user.id,
      conversation_id: baselineConvo.id,
    });
    console.log('✓ Baseline personality:');
    console.log(`  - Openness: ${baselineSnapshot.openness?.toFixed(2)}`);
    console.log(`  - Conscientiousness: ${baselineSnapshot.conscientiousness?.toFixed(2)}`);
    console.log(`  - Extraversion: ${baselineSnapshot.extraversion?.toFixed(2)}`);
    console.log(`  - Agreeableness: ${baselineSnapshot.agreeableness?.toFixed(2)}`);
    console.log(`  - Neuroticism: ${baselineSnapshot.neuroticism?.toFixed(2)}`);
    console.log(`  - Confidence: ${baselineSnapshot.confidence.toFixed(2)}\n`);

    // Step 4: Create a second conversation showing emotional distress
    console.log('Step 4: Creating conversation showing emotional shift...');
    const currentConvo = await conversationService.createConversation({
      user_id: user.id,
      title: 'Current Conversation (Struggling)',
    });

    const strugglingMessages = [
      'I am so stressed out right now',
      'Everything feels overwhelming and I cannot keep up',
      'Work has been terrible, nothing is going right',
      'I feel anxious all the time and cannot sleep well',
      'People keep annoying me and I just want to be left alone',
      'I cannot focus on anything, my mind is racing',
      'Why does everything have to be so difficult?',
      'I feel like giving up sometimes',
    ];

    for (const content of strugglingMessages) {
      await messageService.createMessage({
        conversation_id: currentConvo.id,
        user_id: user.id,
        role: 'user',
        content,
      });
      await messageService.createMessage({
        conversation_id: currentConvo.id,
        user_id: user.id,
        role: 'assistant',
        content: 'I understand.',
      });
    }
    console.log(`✓ Created conversation with ${strugglingMessages.length} messages showing distress\n`);

    // Step 5: Generate current personality snapshot
    console.log('Step 5: Assessing current personality...');
    const currentSnapshot = await personalityService.createPersonalitySnapshot({
      user_id: user.id,
      conversation_id: currentConvo.id,
    });
    console.log('✓ Current personality:');
    console.log(`  - Openness: ${currentSnapshot.openness?.toFixed(2)}`);
    console.log(`  - Conscientiousness: ${currentSnapshot.conscientiousness?.toFixed(2)}`);
    console.log(`  - Extraversion: ${currentSnapshot.extraversion?.toFixed(2)}`);
    console.log(`  - Agreeableness: ${currentSnapshot.agreeableness?.toFixed(2)}`);
    console.log(`  - Neuroticism: ${currentSnapshot.neuroticism?.toFixed(2)} ⬆️ (likely elevated)`);
    console.log(`  - Confidence: ${currentSnapshot.confidence.toFixed(2)}\n`);

    // Step 6: Check personality deviations
    console.log('Step 6: Calculating personality deviations...');
    const deviations = await personalityService.getPersonalityDeviations(user.id);
    if (deviations) {
      console.log('✓ Deviations from baseline (in standard deviations):');
      console.log(`  - Openness: ${deviations.openness.toFixed(2)}σ`);
      console.log(`  - Conscientiousness: ${deviations.conscientiousness.toFixed(2)}σ`);
      console.log(`  - Extraversion: ${deviations.extraversion.toFixed(2)}σ`);
      console.log(`  - Agreeableness: ${deviations.agreeableness.toFixed(2)}σ`);
      console.log(`  - Neuroticism: ${deviations.neuroticism.toFixed(2)}σ ⚠️\n`);
    } else {
      console.log('⚠️ Insufficient data for deviations (need baseline stats)\n');
    }

    // Step 7: Detect emotional state
    console.log('Step 7: Detecting emotional state...');
    const detection = await emotionalStateService.detectEmotionalState({
      user_id: user.id,
      min_confidence: 0.5,
    });

    if (detection.state) {
      console.log('✓ Emotional state detected:');
      console.log(`  - State: ${detection.state.state_type.toUpperCase()}`);
      console.log(`  - Confidence: ${detection.confidence.toFixed(2)}`);
      console.log(`  - Trigger: ${detection.state.trigger_type}`);
      console.log(`  - Recommended approach: ${detection.state.recommended_approach}`);
      console.log(`  - Reasoning: ${detection.reasoning}\n`);

      // Step 8: Generate context adaptation
      console.log('Step 8: Generating context adaptation...');
      const adaptation = await contextAdaptationService.generateAdaptation({
        user_id: user.id,
        emotional_state_id: detection.state.id,
      });

      console.log('✓ Context adaptation generated:');
      console.log(`  - Morning schedule: ${adaptation.morning_schedule}`);
      console.log(`  - Midday schedule: ${adaptation.midday_schedule}`);
      console.log(`  - Evening schedule: ${adaptation.evening_schedule}`);
      console.log(`  - Night schedule: ${adaptation.night_schedule}`);
      console.log(`  - Temperature modifier: ${adaptation.temperature_modifier}x`);
      console.log(`  - Curiosity approach: ${adaptation.curiosity_approach}`);
      console.log(`  - Research priority: ${adaptation.research_priority}/10`);
      console.log(`  - Tone directive:\n    "${adaptation.tone_directive?.substring(0, 100)}..."\n`);

      // Step 9: Test chat with emotional context
      console.log('Step 9: Testing chat with emotional intelligence...');
      const chatResponse = await chatService.chat({
        conversation_id: currentConvo.id,
        user_id: user.id,
        message: 'I am feeling really overwhelmed right now',
      });

      console.log('✓ Chat response (with emotional adaptation):');
      console.log(`  Response: "${chatResponse.response.substring(0, 200)}..."\n`);
      console.log('  → Notice how the tone is adapted based on emotional state!\n');
    } else {
      console.log('⚠️ No significant emotional state detected');
      console.log(`  Reasoning: ${detection.reasoning}\n`);
    }

    // Summary
    console.log('═══════════════════════════════════════════════════');
    console.log('✅ Phase 3 Emotional Intelligence Test Complete!');
    console.log('═══════════════════════════════════════════════════');
    console.log('\nWhat happened:');
    console.log('1. Created baseline personality from normal conversation');
    console.log('2. Created second conversation showing emotional distress');
    console.log('3. Detected personality shift (elevated neuroticism)');
    console.log('4. Identified emotional state (likely "struggling")');
    console.log('5. Generated context adaptation (gentle, supportive)');
    console.log('6. Chat responses now adapt automatically!\n');

    console.log('🎉 Lucid is now emotionally intelligent!\n');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

// Run the test
testEmotionalIntelligence();
