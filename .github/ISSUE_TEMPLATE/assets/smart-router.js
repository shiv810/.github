// Smart router implementation using Octokit and Voyage AI
import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';

class SmartRouter {
  constructor() {
    dotenv.config();
    
    if (!process.env.GITHUB_TOKEN || !process.env.VOYAGE_API_KEY) {
      throw new Error('Missing required environment variables: GITHUB_TOKEN and/or VOYAGE_API_KEY');
    }

    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });

    this.repositories = {};
    this.voyageHeaders = {
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json'
    };
  }

  async initialize() {
    try {
      // Fetch all accessible organizations
      const { data: orgs } = await this.octokit.orgs.listForAuthenticatedUser();
      
      // Add user's personal repos
      await this.fetchUserRepositories();
      
      // Add org repos
      for (const org of orgs) {
        await this.fetchOrgRepositories(org.login);
      }
    } catch (error) {
      console.error('Error initializing SmartRouter:', error);
      throw error;
    }
  }

  async fetchUserRepositories() {
    const { data: repos } = await this.octokit.repos.listForAuthenticatedUser();
    await this.processRepositories(repos);
  }

  async fetchOrgRepositories(orgName) {
    const { data: repos } = await this.octokit.repos.listForOrg({
      org: orgName,
      per_page: 100
    });
    await this.processRepositories(repos);
  }

  async processRepositories(repos) {
    for (const repo of repos) {
      const keywords = this.extractKeywords(repo);
      const description = repo.description || '';
      
      this.repositories[repo.full_name] = {
        description,
        keywords,
        embedding: await this.createEmbedding(`${description} ${keywords.join(' ')}`)
      };
    }
  }

  extractKeywords(repo) {
    const keywords = new Set();
    
    // Extract from topics
    if (repo.topics) {
      repo.topics.forEach(topic => keywords.add(topic));
    }
    
    // Extract from name and description
    const extractFrom = [repo.name, repo.description].join(' ');
    const words = extractFrom.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
    
    words.forEach(word => keywords.add(word));
    
    return Array.from(keywords);
  }

  async createEmbedding(text) {
    try {
      const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: this.voyageHeaders,
        body: JSON.stringify({
          model: 'voyage-01',
          input: text
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to create embedding');
      }

      return data.data[0].embedding;
    } catch (error) {
      console.error('Error creating embedding:', error);
      throw error;
    }
  }

  async findMatches(description) {
    const descriptionEmbedding = await this.createEmbedding(description);
    const matches = [];

    for (const [repo, data] of Object.entries(this.repositories)) {
      const similarity = this.calculateCosineSimilarity(descriptionEmbedding, data.embedding);
      matches.push({ repo, similarity });
    }

    return matches
      .sort((a, b) => b.similarity - a.similarity)
      .map(m => m.repo);
  }

  calculateCosineSimilarity(embedding1, embedding2) {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2)) || 0;
  }
}

// Initialize and inject the router
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const router = new SmartRouter();
    await router.initialize();
    
    const descriptionField = document.querySelector('#description');
    const repoSelect = document.querySelector('#target_repository');

    if (descriptionField && repoSelect) {
      let debounceTimer;
      
      descriptionField.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const description = e.target.value;
          const matches = await router.findMatches(description);
          
          // Update dropdown options based on matches
          Array.from(repoSelect.options).forEach(option => {
            const repo = option.value;
            option.style.display = matches.includes(repo) ? '' : 'none';
          });

          // Select first matching option if current selection is hidden
          if (repoSelect.selectedOptions[0].style.display === 'none') {
            const firstVisible = Array.from(repoSelect.options)
              .find(opt => opt.style.display !== 'none');
            if (firstVisible) {
              firstVisible.selected = true;
            }
          }
        }, 300); // Debounce delay
      });
    }
  } catch (error) {
    console.error('Failed to initialize SmartRouter:', error);
  }
});
