import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/config';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import logoWhite from '../assets/logo-white.png';
import homeBg from '../assets/Home-Screen.png';
import './Dashboard.css';
import './DashboardRedesign.css';

// Google Cloud URL
const API_BASE_URL = 'https://engagetrack-api-938727467811.asia-south1.run.app';

function Dashboard() {
  const [showPopup, setShowPopup] = useState(false);
  const [selectedMode, setSelectedMode] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [error, setError] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [liveStats, setLiveStats] = useState(null);
  const [isLiveAnalyzing, setIsLiveAnalyzing] = useState(false);

  // Student information form fields
  const [studentInfo, setStudentInfo] = useState({
    name: '',
    gender: '',
    email: '',
    rollNumber: '',
    department: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [addUserStep, setAddUserStep] = useState('details');
  const [currentTip, setCurrentTip] = useState(0);

  // Track User section states
  const [showTrackUser, setShowTrackUser] = useState(false);
  const [savedUsers, setSavedUsers] = useState([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  // Profile section states
  const [showProfile, setShowProfile] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    name: '',
    email: '',
    department: '',
    role: '',
    phone: ''
  });


  const videoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const analysisIntervalRef = React.useRef(null);
  const resultsVideoRef = React.useRef(null);
  const previewVideoRef = React.useRef(null);
  const { logout, currentUser } = useAuth();
  const navigate = useNavigate();

  // Initialize profile data 
  useEffect(() => {
    if (currentUser) {
      setProfileData(prev => ({
        ...prev,
        name: currentUser.displayName || prev.name,
        email: currentUser.email || prev.email
      }));
    }
  }, [currentUser]);

  useEffect(() => {
    return () => {
      if (filePreview && filePreview.startsWith('blob:')) {
        URL.revokeObjectURL(filePreview);
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [filePreview, cameraStream]);


  useEffect(() => {
    if (cameraStream && videoRef.current) {
      console.log('Setting video srcObject with stream:', cameraStream);
      videoRef.current.srcObject = cameraStream;
      console.log('Video element srcObject set successfully');
    }
  }, [cameraStream]);

  // Fetch saved users 
  useEffect(() => {
    const fetchSavedUsers = async () => {
      if (!showTrackUser || !currentUser) return;

      setIsLoadingUsers(true);
      try {
        console.log('Fetching saved users from Firestore...');

        const querySnapshot = await getDocs(collection(db, 'analysisResults'));
        const users = [];
        querySnapshot.forEach((doc) => {
          console.log('Found user document:', doc.id, doc.data());
          users.push({ id: doc.id, ...doc.data() });
        });


        users.sort((a, b) => {
          const aTime = a.timestamp?.seconds || 0;
          const bTime = b.timestamp?.seconds || 0;
          return bTime - aTime;
        });

        console.log('Total users fetched:', users.length);
        setSavedUsers(users);
      } catch (error) {
        console.error('Error fetching saved users:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        alert(`Failed to load users: ${error.message}`);
      } finally {
        setIsLoadingUsers(false);
      }
    };

    fetchSavedUsers();
  }, [showTrackUser, currentUser]);

  const startCamera = async () => {
    try {
      console.log('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 }
      });
      console.log('Camera stream obtained:', stream);
      setCameraStream(stream);
      setIsCameraActive(true);
      setError(null);
    } catch (err) {
      console.error('Camera access error:', err);
      setError('Failed to access camera. Please ensure you have granted camera permissions.');
    }
  };

  const stopCamera = () => {
    stopLiveAnalysis();
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
      setIsCameraActive(false);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/jpeg', 0.8);
  };



  const analyzeFrame = async () => {
    try {
      const frameDataUrl = captureFrame();
      if (!frameDataUrl) return;

      // Convert data URL to blob
      const response = await fetch(frameDataUrl);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');

      const apiResponse = await fetch(`${API_BASE_URL}/predict_frame`, {
        method: 'POST',
        body: formData,
      });

      if (!apiResponse.ok) {
        throw new Error(`HTTP error! status: ${apiResponse.status}`);
      }

      const results = await apiResponse.json();

      if (results.error) {
        console.error('Analysis error:', results.message);
        return;
      }

      setLiveStats(results);
    } catch (err) {
      console.error('Frame analysis error:', err);
    }
  };

  const startLiveAnalysis = () => {
    if (analysisIntervalRef.current) return;

    setIsLiveAnalyzing(true);
    // Resume video playback
    if (videoRef.current) {
      videoRef.current.play().catch(err => console.error('Video play error:', err));
    }

    analyzeFrame();

    analysisIntervalRef.current = setInterval(analyzeFrame, 2000);
  };

  const stopLiveAnalysis = () => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
      analysisIntervalRef.current = null;
    }
    // Pause video playback
    if (videoRef.current) {
      videoRef.current.pause();
    }
    setIsLiveAnalyzing(false);
    setLiveStats(null);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('video/') && !file.name.toLowerCase().endsWith('.mp4') && !file.name.toLowerCase().endsWith('.avi')) {
        setError('Please select a video file (MP4 or AVI format)');
        return;
      }

      setSelectedFile(file);
      setError(null);
      setAnalysisResults(null);
      setVideoEnded(false);

      const isMP4 = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');

      if (isMP4) {
        const videoUrl = URL.createObjectURL(file);
        setFilePreview(videoUrl);
      } else {
        setFilePreview(null);
      }


      if (addUserStep === 'upload') {
        setVideoEnded(true);
        setTimeout(() => {
          handleAnalyze();
        }, 500);
      }
    }
  };

  const handleAnalyze = async () => {
    if (selectedMode === 'live') {
      // Start camera for live video
      await startCamera();

      setTimeout(() => {
        startLiveAnalysis();
      }, 1000);
      return;
    }

    // Handle upload mode
    if (!selectedFile) {
      setError('Please select a video file first');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysisResults(null);


    if (addUserStep !== 'upload') {
      setVideoEnded(false);
    }


    if (addUserStep !== 'upload' && previewVideoRef.current && filePreview) {
      previewVideoRef.current.play().catch(err => {
        console.log('Auto-play prevented:', err);
      });
    }

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      console.log('Sending video to API for analysis...');

      const response = await fetch(`${API_BASE_URL}/predict`, {
        method: 'POST',
        body: formData,
      });

      console.log('Response status:', response.status);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const results = await response.json();
      console.log('API Response:', results);

      if (results.error) {
        throw new Error(results.message || 'Analysis failed');
      }

      setAnalysisResults(results);
      console.log('Analysis completed successfully!');


      if (addUserStep === 'upload') {
        setIsAnalyzing(false);
        setAddUserStep('results');
      } else {

        if (previewVideoRef.current && (previewVideoRef.current.ended || previewVideoRef.current.paused)) {
          setIsAnalyzing(false);
          setVideoEnded(true);
        }
      }

    } catch (err) {
      console.error('Analysis error:', err);
      setError(err.message || 'Failed to analyze video. Please try again.');
      setIsAnalyzing(false); // Stop analyzing on error
    }
  };

  const handleSaveResults = async () => {
    // 1. Check for basic input validity
    if (!studentInfo.name || !studentInfo.gender || !studentInfo.email || !studentInfo.rollNumber || !studentInfo.department) {
      setError('Please fill in all student information fields');
      return;
    }

    if (!analysisResults) {
      setError('No analysis results to save');
      return;
    }

    // 2. Check Authentication
    if (!currentUser) {
      setError('You must be logged in to save results.');
      console.error('Save failed: User not authenticated');
      return;
    }

    // 3. Check Network Connectivity
    if (!navigator.onLine) {
      setError('You appear to be offline. Please check your internet connection.');
      return;
    }

    setIsSaving(true);
    setError(null);

    console.log('Attempting to save results for user:', currentUser.uid);

    try {
      // Save to Firestore with timeout

      const savePromise = addDoc(collection(db, 'analysisResults'), {
        studentInfo: {
          name: studentInfo.name || '',
          gender: studentInfo.gender || '',
          email: studentInfo.email || '',
          rollNumber: studentInfo.rollNumber || '',
          department: studentInfo.department || ''
        },
        analysisResults: {
          boredom: analysisResults.boredom || { confidence: 0 },
          engagement: analysisResults.engagement || { confidence: 0 },
          confusion: analysisResults.confusion || { confidence: 0 },
          frustration: analysisResults.frustration || { confidence: 0 },
          attentionScore: typeof analysisResults.attention_score === 'number' ? analysisResults.attention_score : 0,
          framesProcessed: analysisResults.frames_processed || 10,
          modelType: analysisResults.model_type || 'CNN-LSTM'
        },
        userId: currentUser.uid,
        timestamp: new Date(),
        videoFileName: selectedFile?.name || 'Unknown'
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network timeout: Saving took too long. Please check your connection or Firestore status.')), 15000)
      );

      const docRef = await Promise.race([savePromise, timeoutPromise]);

      console.log('Document written with ID: ', docRef.id);
      setSaveSuccess(true);

      // Show toast notification
      const notification = document.createElement('div');
      notification.textContent = 'User saved successfully!';
      notification.style.cssText = 'position: fixed; top: 80px; right: 20px; background: #4CAF50; color: white; padding: 16px 24px; borderRadius: 8px; boxShadow: 0 4px 12px rgba(0,0,0,0.15); zIndex: 10000; fontSize: 14px; fontWeight: 500;';
      document.body.appendChild(notification);
      setTimeout(() => {
        notification.style.transition = 'opacity 0.3s';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
      }, 3000);

      setTimeout(() => {
        handleClosePopup();
      }, 1500);

    } catch (err) {
      console.error('Error saving to Firestore:', err);
      setError(`Failed to save results: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClosePopup = () => {
    if (filePreview && filePreview.startsWith('blob:')) {
      URL.revokeObjectURL(filePreview);
    }
    stopCamera();
    setShowPopup(false);
    setSelectedMode(null);
    setSelectedFile(null);
    setFilePreview(null);
    setAnalysisResults(null);
    setError(null);
    setSaveSuccess(false);
    setShowStudentForm(false);
    setVideoEnded(false);
    setStudentInfo({
      name: '',
      gender: '',
      email: '',
      rollNumber: '',
      department: ''
    });
    setIsAnalyzing(false);
    setAddUserStep('details');
  };

  async function handleLogout() {
    try {
      await logout();
      navigate('/signin', { state: { skipAnimation: true } });
    } catch (error) {
      console.error('Failed to log out', error);
    }
  }

  const containerStyle = {
    backgroundImage: `url(${homeBg})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
    minHeight: '100vh'
  };

  return (
    <div className="dashboard-container" style={containerStyle}>
      <div className="dashboard-overlay">
        <nav className="navbar">
          <div className="nav-logo">
            <img src={logoWhite} alt="Engage Track Logo" className="logo-image" />
          </div>
          <div className="nav-links">
            <a href="#home" className="nav-link">Home</a>
            <a href="#add-user" className="nav-link" onClick={(e) => { e.preventDefault(); setShowPopup(true); setSelectedMode('upload'); setAddUserStep('details'); }}>Add User</a>
            <a href="#track-user" className="nav-link" onClick={(e) => { e.preventDefault(); setShowTrackUser(!showTrackUser); }}>Track User</a>
            <a href="#profile" className="nav-link" onClick={(e) => { e.preventDefault(); setShowProfile(!showProfile); }}>Profile</a>
            <a href="#vision" className="nav-link">Our Vision</a>
            <button onClick={handleLogout} className="nav-link logout-btn">Logout</button>
          </div>
        </nav>
        <div className="main-content">
          <div className="content-text">
            <h1 className="main-heading">Illuminate learning with AI-powered attention tracking from innovation to <span className="fade-word">impact</span></h1>
            <p className="description fade-text">
              We propose an system that integrates learning analytics with educational accessibility through computer vision and deep learning techniques to detect engagement states and support inclusive education.
            </p>
            <button className="try-it-btn fade-btn" onClick={() => setShowPopup(true)}>
              Try it Out
            </button>
          </div>
        </div>
      </div>

      {showPopup && (
        <div className="popup-overlay" onClick={handleClosePopup}>
          <div className="popup-content" onClick={(e) => e.stopPropagation()}>
            <div className="popup-header">
              <h2 className="popup-title">
                {!selectedMode ? 'Choose Analysis Mode' : selectedMode === 'live' ? 'Live Video Analysis' : (analysisResults && videoEnded) ? 'Analysis Results' : 'Upload Video'}
              </h2>
            </div>

            <div className="popup-form">
              {!selectedMode ? (
                <div className="mode-selection">
                  <div className="mode-option" onClick={() => setSelectedMode('live')}>
                    <div className="mode-icon">
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </div>
                    <h3>Live Video</h3>
                    <p>Give permission to access the live camera and analyze the attention in real-time</p>
                  </div>

                  <div className="mode-or-divider">
                    <span className="mode-or-text">OR</span>
                  </div>

                  <div className="mode-option" onClick={() => setSelectedMode('upload')}>
                    <div className="mode-icon">
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17,8 12,3 7,8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <h3>Choose a Video to Upload</h3>
                    <p>Upload a pre-recorded video file to analyze attention and engagement levels</p>
                  </div>
                </div>
              ) : selectedMode === 'live' ? (
                <div className="file-upload-section">
                  {!isCameraActive ? (
                    <div className="file-upload-area">
                      <div className="upload-icon">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                      </div>
                      <div className="upload-text">
                        <h3>Live Camera Feed</h3>
                        <p>Click "Start Analysis" to begin real-time attention tracking</p>
                        <p className="file-types">Camera permission will be requested</p>
                      </div>
                    </div>
                  ) : (
                    <div className="live-analysis-container">
                      <div className="live-video-section">
                        <div className="video-container">
                          <video
                            ref={videoRef}
                            className="live-video-preview"
                            autoPlay
                            playsInline
                            muted
                            onLoadedMetadata={(e) => {
                              e.target.play().catch(err => console.error('Video play error:', err));
                            }}
                          />
                        </div>
                        <canvas ref={canvasRef} style={{ display: 'none' }} />
                      </div>

                      <div className="live-stats-section">
                        {!liveStats ? (
                          // Loading state with tips
                          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#666' }}>
                            <div className="spinner" style={{
                              width: '40px',
                              height: '40px',
                              border: '4px solid #f3f3f3',
                              borderTop: '4px solid #667eea',
                              borderRadius: '50%',
                              animation: 'spin 1s linear infinite',
                              margin: '0 auto 20px auto'
                            }}></div>
                            <p style={{ fontSize: '16px', fontWeight: '500', marginBottom: '30px' }}>Model Loading...</p>
                            <div style={{
                              minHeight: '80px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              <p style={{
                                fontSize: '14px',
                                color: '#667eea',
                                animation: 'fadeTip 7s ease-in-out infinite',
                                maxWidth: '350px',
                                lineHeight: '1.6'
                              }}>
                                {(() => {
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
                                    "Use noise-cancelling headphones to block out distractions"
                                  ];
                                  return tips[Math.floor(Date.now() / 7000) % tips.length];
                                })()}
                              </p>
                            </div>
                            <style>{`
                              @keyframes spin {
                                0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); }
                              }
                              @keyframes fadeTip {
                                0%, 15% { opacity: 0; }
                                20%, 80% { opacity: 1; }
                                85%, 100% { opacity: 0; }
                              }
                            `}</style>
                          </div>
                        ) : (
                          // Stats display
                          <>
                            <h3 className="stats-title">Real-Time Analysis</h3>
                            <div className="live-stats-list">
                              <div className="live-stat-item">
                                <div className="stat-label">Boredom</div>
                                <div className="stat-value">
                                  {liveStats ? (liveStats.boredom.confidence * 100).toFixed(1) : '0.0'}%
                                </div>
                              </div>

                              <div className="live-stat-item">
                                <div className="stat-label">Engagement</div>
                                <div className="stat-value">
                                  {liveStats ? (liveStats.engagement.confidence * 100).toFixed(1) : '0.0'}%
                                </div>
                              </div>

                              <div className="live-stat-item">
                                <div className="stat-label">Confusion</div>
                                <div className="stat-value">
                                  {liveStats ? (liveStats.confusion.confidence * 100).toFixed(1) : '0.0'}%
                                </div>
                              </div>

                              <div className="live-stat-item">
                                <div className="stat-label">Frustration</div>
                                <div className="stat-value">
                                  {liveStats ? (liveStats.frustration.confidence * 100).toFixed(1) : '0.0'}%
                                </div>
                              </div>

                              <div className="attention-score">
                                <div className="stat-label">Attention Score</div>
                                <div className="stat-value stat-large">
                                  {liveStats ? (liveStats.attention_score * 100).toFixed(1) : '0.0'}%
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="error-message">
                      <p>{error}</p>
                    </div>
                  )}

                  <div className="form-actions">
                    <button type="button" className="cancel-btn" onClick={handleClosePopup}>
                      Close
                    </button>
                    {!isCameraActive ? (
                      <button
                        type="button"
                        className="analyze-btn"
                        onClick={handleAnalyze}
                        disabled={isAnalyzing}
                      >
                        Start Analysis
                      </button>
                    ) : (
                      <>
                        {isLiveAnalyzing ? (
                          <button
                            type="button"
                            className="analyze-btn"
                            onClick={stopLiveAnalysis}
                          >
                            Pause Analysis
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="analyze-btn"
                            onClick={startLiveAnalysis}
                          >
                            Resume Analysis
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="file-upload-section">
                  {/* Step 1: Student Details */}
                  {addUserStep === 'details' && (
                    <>
                      <div className="student-form" style={{ maxWidth: '60%', margin: '0 auto' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '24px' }}>Student Information</h3>

                        <div className="form-group">
                          <label className="form-label">Name *</label>
                          <input
                            type="text"
                            className="form-input"
                            value={studentInfo.name}
                            onChange={(e) => setStudentInfo({ ...studentInfo, name: e.target.value })}
                            placeholder="Enter student name"
                          />
                        </div>

                        <div className="form-group" style={{ marginTop: '20px' }}>
                          <label className="form-label">Gender *</label>
                          <select
                            className="form-input"
                            value={studentInfo.gender}
                            onChange={(e) => setStudentInfo({ ...studentInfo, gender: e.target.value })}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                          >
                            <option value="">Select gender</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Other</option>
                          </select>
                        </div>

                        <div className="form-group" style={{ marginTop: '20px' }}>
                          <label className="form-label">Email *</label>
                          <input
                            type="email"
                            className="form-input"
                            value={studentInfo.email}
                            onChange={(e) => setStudentInfo({ ...studentInfo, email: e.target.value })}
                            placeholder="student@example.com"
                          />
                        </div>

                        <div className="form-group" style={{ marginTop: '20px' }}>
                          <label className="form-label">Roll Number *</label>
                          <input
                            type="text"
                            className="form-input"
                            value={studentInfo.rollNumber}
                            onChange={(e) => setStudentInfo({ ...studentInfo, rollNumber: e.target.value })}
                            placeholder="Enter roll number"
                          />
                        </div>

                        <div className="form-group" style={{ marginTop: '20px' }}>
                          <label className="form-label">Department *</label>
                          <input
                            type="text"
                            className="form-input"
                            value={studentInfo.department}
                            onChange={(e) => setStudentInfo({ ...studentInfo, department: e.target.value })}
                            placeholder="e.g., Computer Science"
                          />
                        </div>
                      </div>

                      <div className="form-actions" style={{ paddingRight: '30px', justifyContent: 'flex-end', display: 'flex', gap: '10px', marginTop: '20px' }}>
                        <button type="button" className="cancel-btn" onClick={handleClosePopup}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="analyze-btn"
                          onClick={() => {
                            if (!studentInfo.name || !studentInfo.gender || !studentInfo.email || !studentInfo.rollNumber || !studentInfo.department) {
                              setError('Please fill in all student information fields');
                              return;
                            }
                            setError(null);
                            setAddUserStep('upload');
                          }}
                        >
                          Upload Video
                        </button>
                      </div>
                    </>
                  )}


                  {addUserStep !== 'details' && !selectedFile && (
                    <div className="file-upload-area">
                      <input
                        type="file"
                        id="file-upload"
                        onChange={handleFileSelect}
                        accept="video/mp4,video/avi,.mp4,.avi"
                        style={{ display: 'none' }}
                      />
                      <label htmlFor="file-upload" className="file-upload-label">
                        <div className="upload-icon">
                          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17,8 12,3 7,8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                        </div>
                        <div className="upload-text">
                          <h3>Choose a video to upload</h3>
                          <p>Click here or drag and drop your video file</p>
                          <p className="file-types">Supports: MP4, AVI video formats</p>
                        </div>
                      </label>
                    </div>
                  )}

                  {selectedFile && (
                    <div className="selected-file-info" style={{ display: videoEnded ? 'none' : 'block' }}>
                      <div className="file-info">
                        <div className="file-icon">
                          {filePreview ? (
                            <video
                              ref={previewVideoRef}
                              src={filePreview}
                              className="file-preview"
                              controls
                              preload="metadata"
                              playsInline
                              onEnded={() => {
                                console.log('Video playback ended');
                                setVideoEnded(true);

                                if (analysisResults) {
                                  setIsAnalyzing(false);
                                }
                              }}
                            />
                          ) : (
                            <div className="file-icon-container">
                              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#667eea" strokeWidth="2">
                                <path d="M23 7l-7 5 7 5V7z" />
                                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                              </svg>
                              <p style={{ fontSize: '12px', color: '#666', marginTop: '8px', textAlign: 'center' }}>
                                Preview not available<br />(AVI format)
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="file-details">
                          <p className="file-detail-row"><span className="file-label">File Name:</span> {selectedFile.name}</p>
                          <p className="file-detail-row"><span className="file-label">Type:</span> {selectedFile.type}</p>
                          <p className="file-detail-row"><span className="file-label">Size:</span> {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                          <div className="file-actions">
                            <input
                              type="file"
                              id="file-upload-change"
                              onChange={handleFileSelect}
                              accept="video/mp4,video/avi,.mp4,.avi"
                              style={{ display: 'none' }}
                            />
                            <label htmlFor="file-upload-change" className="change-file-btn">
                              Change File
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="error-message" style={{ marginTop: '10px' }}>
                      <p>{error}</p>
                    </div>
                  )}

                  {isAnalyzing && videoEnded && !analysisResults && (
                    <div className="processing-overlay" style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                      <div className="spinner" style={{
                        width: '30px',
                        height: '30px',
                        border: '3px solid #f3f3f3',
                        borderTop: '3px solid #667eea',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        margin: '0 auto 10px auto'
                      }}></div>
                      <p>Analyzing video content...</p>
                      <div style={{
                        marginTop: '20px',
                        minHeight: '60px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <p style={{
                          fontSize: '14px',
                          color: '#667eea',
                          animation: 'fadeTip 7s ease-in-out infinite',
                          maxWidth: '400px',
                          lineHeight: '1.6'
                        }}>
                          {(() => {
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
                              "Use noise-cancelling headphones to block out distractions"
                            ];
                            return tips[Math.floor(Date.now() / 7000) % tips.length];
                          })()}
                        </p>
                      </div>
                      <style>{`
                        @keyframes spin {
                          0% { transform: rotate(0deg); }
                          100% { transform: rotate(360deg); }
                        }
                        @keyframes fadeTip {
                          0%, 15% { opacity: 0; }
                          20%, 80% { opacity: 1; }
                          85%, 100% { opacity: 0; }
                        }
                      `}</style>
                    </div>
                  )}

                  {/* Step 3: Results - Show in Add User flow OR regular Try It Now flow */}
                  {analysisResults && ((addUserStep === 'results') || (videoEnded && !showStudentForm && addUserStep !== 'details' && addUserStep !== 'upload')) && (

                    <div className="live-analysis-container">
                      {/* Video Preview Section */}
                      <div className="live-video-section">
                        <div className="video-container">
                          {filePreview ? (
                            <video
                              ref={resultsVideoRef}
                              src={filePreview}
                              className="live-video-preview"
                              controls
                              playsInline
                            />
                          ) : (
                            <div className="file-icon-container">
                              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#667eea" strokeWidth="2">
                                <path d="M23 7l-7 5 7 5V7z" />
                                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                              </svg>
                              <p style={{ fontSize: '12px', color: '#666', marginTop: '8px', textAlign: 'center' }}>
                                Video Analyzed<br />(AVI format)
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Attendance Opinion - Placed below video */}
                        <div className="attendance-summary" style={{ marginTop: '20px' }}>
                          {(() => {
                            const score = analysisResults.attention_score * 100;
                            let status = '';
                            let color = '';
                            let message = '';

                            if (score >= 75) {
                              status = 'Present';
                              color = '#4CAF50';
                              message = 'Student is highly engaged. Recommended for full attendance.';
                            } else if (score >= 50) {
                              status = 'Maybe';
                              color = '#FF9800';
                              message = 'Moderate engagement detected. Monitor for improvement.';
                            } else {
                              status = 'Warning';
                              color = '#F44336';
                              message = 'Low attention detected. Intervention or inquiry recommended.';
                            }

                            return (
                              <div className="attendance-card" style={{ borderLeft: `4px solid ${color}`, textAlign: 'left', paddingLeft: '15px' }}>
                                <h4 style={{ color: color, margin: '0 0 4px 0' }}>{status}</h4>
                                <p style={{ fontSize: '14px', margin: 0, color: '#555' }}>{message}</p>
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Analysis Results Section */}
                      <div className="live-stats-section">
                        <h3 className="stats-title">Analysis Results</h3>
                        <div className="live-stats-list">
                          <div className="live-stat-item">
                            <div className="stat-label">Boredom</div>
                            <div className="stat-value">
                              {(analysisResults.boredom.confidence * 100).toFixed(1)}%
                            </div>
                          </div>

                          <div className="live-stat-item">
                            <div className="stat-label">Engagement</div>
                            <div className="stat-value">
                              {(analysisResults.engagement.confidence * 100).toFixed(1)}%
                            </div>
                          </div>

                          <div className="live-stat-item">
                            <div className="stat-label">Confusion</div>
                            <div className="stat-value">
                              {(analysisResults.confusion.confidence * 100).toFixed(1)}%
                            </div>
                          </div>

                          <div className="live-stat-item">
                            <div className="stat-label">Frustration</div>
                            <div className="stat-value">
                              {(analysisResults.frustration.confidence * 100).toFixed(1)}%
                            </div>
                          </div>

                          <div className="live-stat-item">
                            <div className="stat-label">Attention Score</div>
                            <div className="stat-value">
                              {(analysisResults.attention_score * 100).toFixed(1)}%
                            </div>
                          </div>

                          <div className="live-stat-item" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e0e0e0' }}>
                            <div className="stat-label" style={{ fontSize: '12px', color: '#999' }}>
                              Frames processed: {analysisResults.frames_processed || 10}
                            </div>

                            {/* Cancel and Add User buttons */}
                            <div className="results-action-buttons">
                              <button
                                type="button"
                                className="results-cancel-btn"
                                onClick={handleClosePopup}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="results-save-btn"
                                onClick={() => setShowStudentForm(true)}
                              >
                                Add User
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {analysisResults && videoEnded && showStudentForm && (
                    <div className="live-analysis-container" style={{ gap: '40px' }}>
                      <div className="live-video-section" style={{ flex: '0 0 35%' }}>
                        <div className="student-info-form">
                          <h3 className="stats-title">Student Information</h3>

                          <div className="form-group">
                            <label className="form-label">
                              Name <span className="required-asterisk">*</span>
                            </label>
                            <input
                              type="text"
                              className="form-input"
                              value={studentInfo.name}
                              onChange={(e) => setStudentInfo({ ...studentInfo, name: e.target.value })}
                              placeholder="Enter student name"
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">
                              Gender <span className="required-asterisk">*</span>
                            </label>
                            <select
                              className="form-input"
                              value={studentInfo.gender}
                              onChange={(e) => setStudentInfo({ ...studentInfo, gender: e.target.value })}
                            >
                              <option value="">Select gender</option>
                              <option value="Male">Male</option>
                              <option value="Female">Female</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>

                          <div className="form-group">
                            <label className="form-label">
                              Email <span className="required-asterisk">*</span>
                            </label>
                            <input
                              type="email"
                              className="form-input"
                              value={studentInfo.email}
                              onChange={(e) => setStudentInfo({ ...studentInfo, email: e.target.value })}
                              placeholder="student@example.com"
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">
                              Roll Number <span className="required-asterisk">*</span>
                            </label>
                            <input
                              type="text"
                              className="form-input"
                              value={studentInfo.rollNumber}
                              onChange={(e) => setStudentInfo({ ...studentInfo, rollNumber: e.target.value })}
                              placeholder="Enter roll number"
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">
                              Department <span className="required-asterisk">*</span>
                            </label>
                            <input
                              type="text"
                              className="form-input"
                              value={studentInfo.department}
                              onChange={(e) => setStudentInfo({ ...studentInfo, department: e.target.value })}
                              placeholder="e.g., Computer Science"
                            />
                          </div>

                          {saveSuccess && (
                            <div className="success-message">
                              ✓ Results saved successfully!
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Video Snapshot & Analysis Summary */}
                      <div className="live-stats-section" style={{ flex: '1' }}>
                        <div style={{ maxWidth: '420px', width: '100%', margin: '0 0 0 auto' }}>
                          {/* 1. Video Snapshot */}
                          <div className="video-container" style={{ marginBottom: '20px', height: 'auto', textAlign: 'center' }}>
                            {filePreview ? (
                              <video
                                src={filePreview}
                                className="live-video-preview"
                                style={{
                                  width: '100%',
                                  maxWidth: '400px',
                                  height: 'auto',
                                  borderRadius: '8px',
                                  objectFit: 'contain',
                                  maxHeight: '250px'
                                }}
                                muted
                                playsInline
                              />
                            ) : (
                              <div className="file-icon-container" style={{ height: '100%' }}>
                                <p style={{ fontSize: '12px', color: '#666', textAlign: 'center', paddingTop: '60px' }}>
                                  Video Snapshot
                                </p>
                              </div>
                            )}
                          </div>

                          {/* 2. Attendance Opinion */}
                          <div className="attendance-summary" style={{ marginBottom: '20px', width: '100%' }}>
                            {(() => {
                              const score = analysisResults.attention_score * 100;
                              let color = '';
                              let recommendation = '';

                              if (score >= 75) {
                                color = '#4CAF50';
                                recommendation = 'Student is highly engaged.';
                              } else if (score >= 50) {
                                color = '#FF9800';
                                recommendation = 'Moderate engagement detected.';
                              } else {
                                color = '#F44336';
                                recommendation = 'Low attention detected.';
                              }

                              return (
                                <div className="attendance-card" style={{ borderLeft: `4px solid ${color}`, textAlign: 'left', paddingLeft: '15px' }}>
                                  <h4 style={{ color: color, margin: '0 0 4px 0' }}>Attendance Stat</h4>
                                  <p style={{ fontSize: '13px', margin: '4px 0 0 0', color: '#555' }}>{recommendation}</p>
                                </div>
                              );
                            })()}
                          </div>

                          {/* 3. Detailed Stats */}
                          <div style={{ width: '100%' }}>
                            <h3 className="stats-title" style={{ textAlign: 'left', marginBottom: '8px' }}>Analysis Results</h3>
                            <p style={{ fontSize: '12px', color: '#999', textAlign: 'left', marginBottom: '15px' }}>
                              {new Date().toLocaleString()}
                            </p>

                            <div className="live-stats-list" style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '15px'
                            }}>
                              {/* Boredom & Engagement */}
                              <div className="live-stat-item" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ textAlign: 'left' }}>
                                  <div className="stat-label">Boredom</div>
                                  <div className="stat-value">
                                    {(analysisResults.boredom.confidence * 100).toFixed(1)}%
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div className="stat-label">Engagement</div>
                                  <div className="stat-value">
                                    {(analysisResults.engagement.confidence * 100).toFixed(1)}%
                                  </div>
                                </div>
                              </div>

                              {/* Confusion & Frustration */}
                              <div className="live-stat-item" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ textAlign: 'left' }}>
                                  <div className="stat-label">Confusion</div>
                                  <div className="stat-value">
                                    {(analysisResults.confusion.confidence * 100).toFixed(1)}%
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div className="stat-label">Frustration</div>
                                  <div className="stat-value">
                                    {(analysisResults.frustration.confidence * 100).toFixed(1)}%
                                  </div>
                                </div>
                              </div>

                              {/* Attention Score  */}
                              <div className="live-stat-item" style={{ gridColumn: '1 / -1' }}>
                                <div className="stat-label">Attention Score</div>
                                <div className="stat-value">
                                  {(analysisResults.attention_score * 100).toFixed(1)}%
                                </div>
                              </div>

                              <div className="live-stat-item" style={{
                                gridColumn: '1 / -1',
                                marginTop: '10px',
                                paddingTop: '10px',
                                borderTop: '1px solid #e0e0e0'
                              }}>
                                {/* Actions */}
                                <div className="results-action-buttons">
                                  <button
                                    type="button"
                                    className="results-cancel-btn"
                                    onClick={handleClosePopup}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="results-save-btn"
                                    onClick={handleSaveResults}
                                    disabled={isSaving}
                                  >
                                    {isSaving ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!videoEnded && !showStudentForm && addUserStep !== 'details' && (
                    <div className="form-actions">
                      <button type="button" className="cancel-btn" onClick={handleClosePopup}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="analyze-btn"
                        onClick={handleAnalyze}
                        disabled={!selectedFile || isAnalyzing}
                      >
                        {isAnalyzing ? 'Analyzing...' : 'Analyze'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )
      }

      {/* Track User Section */}
      {
        showTrackUser && (
          <div className="popup-overlay" onClick={() => setShowTrackUser(false)}>
            <div className="popup-content" style={{ maxWidth: '1200px' }} onClick={(e) => e.stopPropagation()}>
              <div className="popup-header">
                <h2 className="popup-title">Track Users</h2>
                <button
                  onClick={() => setShowTrackUser(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '24px',
                    cursor: 'pointer',
                    color: '#666'
                  }}
                >
                  ×
                </button>
              </div>

              <div className="popup-form" style={{ padding: '20px' }}>
                {isLoadingUsers ? (
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <div className="spinner" style={{
                      width: '40px',
                      height: '40px',
                      border: '4px solid #f3f3f3',
                      borderTop: '4px solid #667eea',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      margin: '0 auto'
                    }}></div>
                    <p style={{ marginTop: '20px', color: '#666' }}>Loading saved users...</p>
                  </div>
                ) : savedUsers.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ margin: '0 auto 20px' }}>
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <h3>No Users Found</h3>
                    <p>Add your first user to start tracking their engagement.</p>
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
                    gap: '20px',
                    maxHeight: '70vh',
                    overflowY: 'auto'
                  }}>
                    {savedUsers.map((user) => (
                      <div key={user.id} style={{
                        background: 'white',
                        border: '1px solid #e0e0e0',
                        borderRadius: '12px',
                        padding: '20px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        transition: 'transform 0.2s, box-shadow 0.2s',
                        cursor: 'pointer'
                      }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-4px)';
                          e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                        }}
                      >
                        {/* Student Info with Photo */}
                        <div style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: '15px', marginBottom: '15px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <h3 style={{ margin: '0', color: '#333', fontSize: '18px', flex: 1, textAlign: 'left' }}>
                              {user.studentInfo?.name || 'Unknown'}
                            </h3>
                            {user.videoFileName && (
                              <div style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '8px',
                                background: '#f0f0f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginLeft: '10px',
                                overflow: 'hidden'
                              }}>
                                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2">
                                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                  <circle cx="12" cy="13" r="4" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: '#666', textAlign: 'left' }}>
                            <div><strong>Roll:</strong> {user.studentInfo?.rollNumber || 'N/A'}</div>
                            <div><strong>Department:</strong> {user.studentInfo?.department || 'N/A'}</div>
                            <div><strong>Email:</strong> {user.studentInfo?.email || 'N/A'}</div>
                          </div>
                        </div>

                        {/* Analysis Stats */}
                        <div style={{ marginBottom: '12px' }}>
                          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#000' }}>Analysis Results</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                            <div style={{ background: '#f8f9ff', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ color: '#999', marginBottom: '2px' }}>Boredom</div>
                              <div style={{ fontWeight: 'bold', color: '#333' }}>
                                {((user.analysisResults?.boredom?.confidence || 0) * 100).toFixed(1)}%
                              </div>
                            </div>
                            <div style={{ background: '#f8f9ff', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ color: '#999', marginBottom: '2px' }}>Engagement</div>
                              <div style={{ fontWeight: 'bold', color: '#4CAF50' }}>
                                {((user.analysisResults?.engagement?.confidence || 0) * 100).toFixed(1)}%
                              </div>
                            </div>
                            <div style={{ background: '#f8f9ff', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ color: '#999', marginBottom: '2px' }}>Confusion</div>
                              <div style={{ fontWeight: 'bold', color: '#333' }}>
                                {((user.analysisResults?.confusion?.confidence || 0) * 100).toFixed(1)}%
                              </div>
                            </div>
                            <div style={{ background: '#f8f9ff', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ color: '#999', marginBottom: '2px' }}>Frustration</div>
                              <div style={{ fontWeight: 'bold', color: '#F44336' }}>
                                {((user.analysisResults?.frustration?.confidence || 0) * 100).toFixed(1)}%
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Attention Score */}
                        <div style={{
                          background: '#000',
                          padding: '12px',
                          borderRadius: '8px',
                          color: 'white',
                          textAlign: 'center'
                        }}>
                          <div style={{ fontSize: '11px', opacity: 0.9, marginBottom: '4px' }}>Attention Score</div>
                          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                            {((user.analysisResults?.attentionScore || 0) * 100).toFixed(1)}%
                          </div>
                        </div>

                        {/* Timestamp */}
                        <div style={{ marginTop: '12px', fontSize: '11px', color: '#999', textAlign: 'center' }}>
                          {user.timestamp ? new Date(user.timestamp.seconds * 1000).toLocaleString() : 'Unknown date'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }

      {/* Profile Section */}
      {
        showProfile && (
          <div className="popup-overlay" onClick={() => setShowProfile(false)}>
            <div className="popup-content" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
              <div className="popup-header">
                <h2 className="popup-title">My Profile</h2>
                <button
                  onClick={() => setShowProfile(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '24px',
                    cursor: 'pointer',
                    color: '#666'
                  }}
                >
                  ×
                </button>
              </div>

              <div className="popup-form" style={{ padding: '30px' }}>
                <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, color: '#333' }}>Personal Information</h3>
                  {!isEditingProfile ? (
                    <button
                      onClick={() => setIsEditingProfile(true)}
                      style={{
                        background: '#000',
                        color: 'white',
                        border: 'none',
                        padding: '8px 20px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                    >
                      Edit Profile
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={() => setIsEditingProfile(false)}
                        style={{
                          background: '#e0e0e0',
                          color: '#333',
                          border: 'none',
                          padding: '8px 20px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          setIsEditingProfile(false);
                          // Notification
                          const notification = document.createElement('div');
                          notification.textContent = 'Profile updated successfully!';
                          notification.style.cssText = 'position: fixed; top: 80px; right: 20px; background: #4CAF50; color: white; padding: 16px 24px; borderRadius: 8px; boxShadow: 0 4px 12px rgba(0,0,0,0.15); zIndex: 10000; fontSize: 14px; fontWeight: 500;';
                          document.body.appendChild(notification);
                          setTimeout(() => {
                            notification.style.transition = 'opacity 0.3s';
                            notification.style.opacity = '0';
                            setTimeout(() => notification.remove(), 300);
                          }, 3000);
                        }}
                        style={{
                          background: '#000',
                          color: 'white',
                          border: 'none',
                          padding: '8px 20px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: '500'
                        }}
                      >
                        Save Changes
                      </button>
                    </div>
                  )}
                </div>

                <div className="student-form">
                  <div className="form-group">
                    <label className="form-label">Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={profileData.name}
                      onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                      disabled={!isEditingProfile}
                      placeholder="Enter your name"
                    />
                  </div>

                  <div className="form-group" style={{ marginTop: '20px' }}>
                    <label className="form-label">Email *</label>
                    <input
                      type="email"
                      className="form-input"
                      value={profileData.email}
                      onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                      disabled={!isEditingProfile}
                      placeholder="your.email@example.com"
                    />
                  </div>

                  <div className="form-group" style={{ marginTop: '20px' }}>
                    <label className="form-label">Phone</label>
                    <input
                      type="tel"
                      className="form-input"
                      value={profileData.phone}
                      onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                      disabled={!isEditingProfile}
                      placeholder="+1 (555) 000-0000"
                    />
                  </div>

                  <div className="form-group" style={{ marginTop: '20px' }}>
                    <label className="form-label">Department</label>
                    <input
                      type="text"
                      className="form-input"
                      value={profileData.department}
                      onChange={(e) => setProfileData({ ...profileData, department: e.target.value })}
                      disabled={!isEditingProfile}
                      placeholder="e.g., Computer Science"
                    />
                  </div>

                  <div className="form-group" style={{ marginTop: '20px' }}>
                    <label className="form-label">Role</label>
                    <select
                      className="form-input"
                      value={profileData.role}
                      onChange={(e) => setProfileData({ ...profileData, role: e.target.value })}
                      disabled={!isEditingProfile}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    >
                      <option value="">Select role</option>
                      <option value="teacher">Teacher</option>
                      <option value="administrator">Administrator</option>
                      <option value="researcher">Researcher</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                {/* Account Info */}
                <div style={{ marginTop: '30px', padding: '20px', background: '#f8f9ff', borderRadius: '8px', textAlign: 'left' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: '#000', fontSize: '14px' }}>Account Information</h4>
                  <div style={{ fontSize: '13px', color: '#666', textAlign: 'left' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>User ID:</strong> {currentUser?.uid || 'N/A'}
                    </div>
                    <div>
                      <strong>Account Created:</strong> {currentUser?.metadata?.creationTime ? new Date(currentUser.metadata.creationTime).toLocaleDateString() : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

export default Dashboard;