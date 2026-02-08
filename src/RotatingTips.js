import React, { useState, useEffect } from 'react';

const RotatingTips = () => {
    const tips = [
        "Take short breaks every 25 minutes to refresh your focus",
        "Minimize distractions by turning off notifications during class",
        "Maintain good posture to stay alert and engaged",
        "Practice deep breathing to improve concentration",
        "Take notes actively to enhance retention and focus",
        "Look away from the screen every 20 minutes to reduce eye strain",
        "Stay hydrated to maintain optimal brain function",
        "Create a dedicated study space free from distractions",
        "Get adequate sleep to improve attention and memory",
        "Use noise-cancelling headphones to block out distractions",
        "Follow the 20-20-20 rule: Every 20 minutes, look at 20 feet for 20s",
        "Adjust your screen brightness to match your room lighting",
        "Blink often to keep your eyes moist and reduce irritation",
        "Stretch your shoulders and neck every hour",
        "Organize your workspace to minimize visual clutter"
    ];

    const [currentTipIndex, setCurrentTipIndex] = useState(0);

    useEffect(() => {
        // Start interval to change tip every 7 seconds
        // This syncs with the CSS animation duration
        const interval = setInterval(() => {
            setCurrentTipIndex((prevIndex) => (prevIndex + 1) % tips.length);
        }, 7000);

        return () => clearInterval(interval);
    }, [tips.length]);

    return <>{tips[currentTipIndex]}</>;
};

export default RotatingTips;
