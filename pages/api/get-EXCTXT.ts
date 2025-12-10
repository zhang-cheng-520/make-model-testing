import type { NextApiRequest, NextApiResponse } from 'next';

type ExcessItem = { 
  title: string; 
  subtitle?: string; 
  value: string 
};
type ExcessResult = { 
  policy_excess: ExcessItem[]; 
  additional_excess: ExcessItem[] 
};

// Function to convert text to proper title case
function toTitleCase(str: string): string {
    const lowercaseWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet'];
    
    return str.split(' ').map((word, index) => {
        // Always capitalize first word and words after hyphens or slashes
        if (index === 0 || word.includes('-') || word.includes('/')) {
            return word.split(/[-\/]/).map(part =>
                part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
            ).join(word.includes('/') ? '/' : '-');
        }
        // Keep lowercase words lowercase unless they're the first word
        if (lowercaseWords.includes(word.toLowerCase())) {
            return word.toLowerCase();
        }
        // Capitalize everything else
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
}

// Function to merge lines and build complete items
function mergeAndExtractPairs(text: string): ExcessItem[] {
    const pairs: ExcessItem[] = [];
    const lines = text.split('//').map(line => line.trim()).filter(line => line && !/^(ADDITIONAL EXCESS|[-–—_=]+)$/i.test(line));
    
    console.log('Lines to process:', lines);
    
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        
        // Updated regex to handle SGD [Excess], SGD 1,500.00, SGD X,XXX.00, and SGD 3,0000.00
        const valueMatch = line.match(/SGD\s*(?:\[\w+\]|[\d,X]+\.?\d{0,2})/i);
        
        if (valueMatch) {
            const value = valueMatch[0];
            const textBeforeValue = line.substring(0, line.indexOf(value)).trim();
            
            console.log(`Processing line ${i}:`, { textBeforeValue, value });
            
            // Create the base item
            const item: ExcessItem = {
                title: toTitleCase(textBeforeValue.replace(/^SECTION\s+I\s*[-–]\s*/i, '').trim()),
                value: value
            };
            
            // Check if next line is a subtitle
            if (i + 1 < lines.length && lines[i + 1].startsWith('(')) {
                const subtitleContent = lines[i + 1].replace(/[()]/g, '').trim();
                item.subtitle = toTitleCase(subtitleContent);
                console.log(`Added subtitle from line ${i+1}:`, subtitleContent);
                i++; // Skip the subtitle line
            }
            
            pairs.push(item);
        } else {
            console.log(`Skipping line ${i} (no SGD value):`, line);
        }
        i++;
    }

    return pairs;
}

function parseExcessText(inputString: string): ExcessResult {
    const result: ExcessResult = {
        policy_excess: [],
        additional_excess: []
    };

    // Normalize the input - replace multiple spaces with single space
    const normalized = inputString
        .replace(/\s+/g, ' ')
        .replace(/\/{2,}/g, '//')
        .trim();

    // Find the split point for additional excess (case insensitive)
    const additionalExcessRegex = /ADDITIONAL\s+EXCESS[:]*/i;
    const splitMatch = additionalExcessRegex.exec(normalized);
    
    if (splitMatch) {
        // Has additional excess section
        const splitIndex = splitMatch.index;
        const policySection = normalized.substring(0, splitIndex).trim();
        const additionalSection = normalized.substring(splitIndex + splitMatch[0].length)
            .replace(/[-–—_=]{2,}/g, '')
            .trim();

        console.log('Policy section:', policySection);
        console.log('Additional section:', additionalSection);

        // Extract and assign pairs
        result.policy_excess = mergeAndExtractPairs(policySection);
        result.additional_excess = mergeAndExtractPairs(additionalSection);
    } else {
        // No additional excess section - treat everything as policy excess
        console.log('No ADDITIONAL EXCESS section found, treating all as policy_excess');
        result.policy_excess = mergeAndExtractPairs(normalized);
    }
    
    return result;
}
/**
 * GET /api/excess
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Disable caching for development
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Get query parameter to select which response to use
    const { test } = req.query;

    let sqlResponse: string;
    switch (test) {
      case '1':
        sqlResponse = "WINDSCREEN/SUN/MOON/GLASS ROOF (WHERE APPLICABLE)         SGD  500.00////SECTION I - STANDARD EXCESS                    SGD [Excess]//      (INSURED/NAMED DRIVER)//SECTION I - STANDARD EXCESS (OUTSIDE OF SINGAPORE)        SGD X,XXX.00//      (INSURED/NAMED DRIVER)////ADDITIONAL EXCESS://------------------//SECTION I - UNNAMED DRIVERS                    SGD 1,500.00//SECTION I – YOUNG OR INEXPERIENCED DRIVERS EXCESS         SGD 3,000.00//(AGE <26 OR HOLDS A VALID DRIVING LICENSE FOR <2 YEARS)";
        break;
      case '2':
        sqlResponse = "WINDSCREEN                          SGD 100.00//SECTION I - STANDARD EXCESS                  SGD [Excess]//      (ANY AUTHORISED DRIVER)////ADDITIONAL EXCESS://------------------//SECTION I – YOUNG OR INEXPERIENCED DRIVERS EXCESS       SGD 3,000.00//(AGE <26 OR HOLDS A VALID DRIVING LICENSE FOR <2 YEARS)"
        break;
      case '3':
        sqlResponse = "WINDSCREEN                           SGD  100.00//SECTION I - INSURED/NAMED DRIVER                SGD  500.00//SECTION I - JOHN TAN                      SGD 2,500.00// //ADDITIONAL EXCESS//------------------//SECTION I - UNNAMED DRIVERS                  SGD 500.00//SECTION I – AGE <26, AGE >65 OR DRIVING EXP <2 YEARS      SGD 3,000.00//"
        break;
      case '4':
        sqlResponse = "WINDSCREEN                           SGD 100.00//SECTION I - STANDARD EXCESS                  SGD [Excess]//      (INSURED/NAMED DRIVER)////ADDITIONAL EXCESS://------------------//SECTION I - UNNAMED DRIVERS                  SGD 500.00//SECTION I – YOUNG OR INEXPERIENCED DRIVERS EXCESS       SGD 3,000.00   // (AGE <26 OR HOLDS A VALID DRIVING LICENSE FOR <2 YEARS)"
        break;
      case '5':
        sqlResponse = "WINDSCREEN/SUN/MOON/GLASS ROOF (WHERE APPLICABLE)       SGD 100.00//SECTION I - STANDARD EXCESS                  SGD [Excess]//      (INSURED/NAMED DRIVER)////ADDITIONAL EXCESS://------------------//SECTION I - UNNAMED DRIVERS                  SGD 500.00//SECTION I – YOUNG OR INEXPERIENCED DRIVERS EXCESS       SGD 3,000.00   // (AGE <26 OR HOLDS A VALID DRIVING LICENSE FOR <2 YEARS)"
        break;
      case '6':
        sqlResponse = "WINDSCREEN                           SGD 100.00//SECTION I - INSURED/NAMED DRIVER                SGD [Excess]////ADDITIONAL EXCESS://------------------//SECTION I - UNNAMED DRIVERS                  SGD 500.00//SECTION I – AGE <26, AGE >65 OR DRIVING EXP <2 YEARS      SGD 3,000.00"
        break;
      case '7':
        sqlResponse = "WINDSCREEN/SUN/MOON/GLASS ROOF (WHERE APPLICABLE)     SGD  500.00////SECTION I - INSURED/NAMED DRIVER              SGD [Excess]//SECTION I - INSURED/NAMED DRIVER (OUTSIDE OF SINGAPORE)  SGD 3,0000.00"
        break;
      case '8':
        sqlResponse = "WINDSCREEN                                                     SGD 100.00//SECTION I - STANDARD EXCESS                                    SGD [Excess]//            (INSURED/NAMED DRIVER)////ADDITIONAL EXCESS://------------------//SECTION I - UNNAMED DRIVERS                                    SGD 500.00//SECTION I – YOUNG OR INEXPERIENCED DRIVERS EXCESS              SGD 3,000.00     // (AGE <26 OR HOLDS A VALID DRIVING LICENSE FOR <2 YEARS)"
        break;
      default:
        sqlResponse = "WINDSCREEN/SUN/MOON/GLASS ROOF (WHERE APPLICABLE) SGD 100.00//SECTION I - STANDARD EXCESS SGD [Excess]// (INSURED/NAMED DRIVER)////ADDITIONAL EXCESS://------------------//SECTION I - UNNAMED DRIVERS SGD 500.00//SECTION I – YOUNG OR INEXPERIENCED DRIVERS EXCESS SGD 3,000.00 // (AGE <26 OR HOLDS A VALID DRIVING LICENSE FOR <2 YEARS)";
    }


    // if (test === '2') {
    // } else {
    //     // Default to first response - FIXED THE TYPO (MON -> MOON)
    // }

    const parsed = parseExcessText(sqlResponse);
    
    // Add timestamp and test case info to prevent caching and for debugging
    const responseWithTimestamp = {
        ...parsed,
        timestamp: new Date().toISOString(),
        testCase: test || 'default',
        sqlResponseUsed: `Test Case ${test || 'default'}`
    };
    
    return res.status(200).json(responseWithTimestamp);
}