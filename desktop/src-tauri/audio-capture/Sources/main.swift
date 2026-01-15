import Foundation
import CoreAudio
import AVFoundation

/// Audio capture mode
enum CaptureMode: Int {
    case microphone = 0
    case systemAudio = 1
    case both = 2
}

/// Message types for IPC
struct Message: Codable {
    let type: String
    let data: String?
    let error: String?
}

/// Audio capture manager using macOS Audio Taps API (14.2+)
class AudioCaptureManager {
    private var deviceID: AudioObjectID = kAudioObjectUnknown
    private var aggregateDeviceID: AudioObjectID = kAudioObjectUnknown
    private var systemAudioTapID: AudioObjectID = kAudioObjectUnknown
    private var ioProcID: AudioDeviceIOProcID?
    private var isCapturing = false
    private var sampleRate: UInt32 = 48000
    private var channels: UInt32 = 1
    
    /// Check if Audio Taps API is available (macOS 14.2+)
    func isAvailable() -> Bool {
        if #available(macOS 14.2, *) {
            return true
        }
        return false
    }
    
    /// Check microphone permission
    func checkMicPermission() -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return false
        default:
            return false
        }
    }
    
    /// Request microphone permission
    func requestMicPermission(completion: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            completion(granted)
        }
    }
    
    /// Start capturing system audio
    func startCapture(sampleRate: UInt32, channels: UInt32, mode: CaptureMode) -> Bool {
        guard !isCapturing else { return false }
        
        self.sampleRate = sampleRate
        self.channels = channels
        
        switch mode {
        case .microphone:
            return setupMicrophoneOnly()
        case .systemAudio:
            return setupSystemAudioOnly()
        case .both:
            return setupBoth()
        }
    }
    
    /// Stop capturing
    func stopCapture() {
        guard isCapturing else { return }
        
        stopIO()
        
        // Destroy tap if created
        if systemAudioTapID != kAudioObjectUnknown {
            if #available(macOS 14.2, *) {
                AudioHardwareDestroyProcessTap(systemAudioTapID)
            }
            systemAudioTapID = kAudioObjectUnknown
        }
        
        // Destroy aggregate device if created
        if aggregateDeviceID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
            aggregateDeviceID = kAudioObjectUnknown
        }
        
        deviceID = kAudioObjectUnknown
        isCapturing = false
    }
    
    // MARK: - Private Methods
    
    private func setupMicrophoneOnly() -> Bool {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var dataSize = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &deviceID
        )
        
        guard status == noErr, deviceID != kAudioObjectUnknown else {
            return false
        }
        
        return startIO()
    }
    
    private func setupSystemAudioOnly() -> Bool {
        guard #available(macOS 14.2, *) else {
            sendError("System audio capture requires macOS 14.2 or later")
            return false
        }
        
        // Create a tap to capture all system audio
        guard let tapID = createSystemAudioTap() else {
            return false
        }
        
        // Create aggregate device with the tap
        guard createAggregateDeviceWithTap(tapID: tapID) else {
            return false
        }
        
        return startIO()
    }
    
    private func setupBoth() -> Bool {
        guard #available(macOS 14.2, *) else {
            sendError("Combined audio capture requires macOS 14.2 or later")
            return false
        }
        
        // Create tap for system audio
        guard let tapID = createSystemAudioTap() else {
            return false
        }
        
        // Get default input device
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var micDevice: AudioObjectID = kAudioObjectUnknown
        var dataSize = UInt32(MemoryLayout<AudioObjectID>.size)
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &micDevice
        )
        
        // Create aggregate device with both
        guard createAggregateDeviceWithMicAndTap(micDevice: micDevice, tapID: tapID) else {
            return false
        }
        
        return startIO()
    }
    
    @available(macOS 14.2, *)
    private func createSystemAudioTap() -> AudioObjectID? {
        let description = CATapDescription()
        description.name = "Moldable System Audio"
        description.processes = []  // Empty = capture all processes
        description.isPrivate = true
        description.isMixdown = true
        description.isMono = false
        description.isExclusive = false
        description.muteBehavior = .unmuted
        
        var tapID: AudioObjectID = kAudioObjectUnknown
        let status = AudioHardwareCreateProcessTap(description, &tapID)
        
        if status == noErr && tapID != kAudioObjectUnknown {
            systemAudioTapID = tapID
            return tapID
        } else if status == kAudioHardwareIllegalOperationError {
            sendError("System audio permission denied. Please grant permission in System Settings > Privacy & Security > Audio Recording")
        } else {
            sendError("Failed to create system audio tap (error: \(status))")
        }
        
        return nil
    }
    
    private func createAggregateDeviceWithTap(tapID: AudioObjectID) -> Bool {
        // Get tap UID
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var tapUID: CFString?
        var dataSize = UInt32(MemoryLayout<CFString>.size)
        let status = AudioObjectGetPropertyData(tapID, &propertyAddress, 0, nil, &dataSize, &tapUID)
        
        guard status == noErr, let tapUID = tapUID else {
            return false
        }
        
        // Create aggregate device
        let desc: [String: Any] = [
            kAudioAggregateDeviceNameKey as String: "Moldable Audio Capture",
            kAudioAggregateDeviceUIDKey as String: "com.moldable.audiocapture.\(Date().timeIntervalSince1970)",
            kAudioAggregateDeviceIsPrivateKey as String: true
        ]
        
        var createStatus = AudioHardwareCreateAggregateDevice(desc as CFDictionary, &aggregateDeviceID)
        
        guard createStatus == noErr, aggregateDeviceID != kAudioObjectUnknown else {
            return false
        }
        
        // Add tap to aggregate device
        propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioAggregateDevicePropertyTapList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var tapList = [tapUID] as CFArray
        dataSize = UInt32(MemoryLayout<CFArray>.size)
        createStatus = AudioObjectSetPropertyData(aggregateDeviceID, &propertyAddress, 0, nil, dataSize, &tapList)
        
        guard createStatus == noErr else {
            return false
        }
        
        deviceID = aggregateDeviceID
        return true
    }
    
    private func createAggregateDeviceWithMicAndTap(micDevice: AudioObjectID, tapID: AudioObjectID) -> Bool {
        // Create aggregate device
        let desc: [String: Any] = [
            kAudioAggregateDeviceNameKey as String: "Moldable Audio Capture",
            kAudioAggregateDeviceUIDKey as String: "com.moldable.audiocapture.\(Date().timeIntervalSince1970)",
            kAudioAggregateDeviceIsPrivateKey as String: true,
            kAudioAggregateDeviceIsStackedKey as String: true
        ]
        
        var createStatus = AudioHardwareCreateAggregateDevice(desc as CFDictionary, &aggregateDeviceID)
        
        guard createStatus == noErr, aggregateDeviceID != kAudioObjectUnknown else {
            return false
        }
        
        // Add microphone if available
        if micDevice != kAudioObjectUnknown {
            if let micUID = getDeviceUID(device: micDevice) {
                var propertyAddress = AudioObjectPropertyAddress(
                    mSelector: kAudioAggregateDevicePropertyFullSubDeviceList,
                    mScope: kAudioObjectPropertyScopeGlobal,
                    mElement: kAudioObjectPropertyElementMain
                )
                
                var deviceList = [micUID] as CFArray
                var dataSize = UInt32(MemoryLayout<CFArray>.size)
                AudioObjectSetPropertyData(aggregateDeviceID, &propertyAddress, 0, nil, dataSize, &deviceList)
            }
        }
        
        // Add tap
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var tapUID: CFString?
        var dataSize = UInt32(MemoryLayout<CFString>.size)
        let status = AudioObjectGetPropertyData(tapID, &propertyAddress, 0, nil, &dataSize, &tapUID)
        
        guard status == noErr, let tapUID = tapUID else {
            return false
        }
        
        propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioAggregateDevicePropertyTapList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var tapList = [tapUID] as CFArray
        dataSize = UInt32(MemoryLayout<CFArray>.size)
        createStatus = AudioObjectSetPropertyData(aggregateDeviceID, &propertyAddress, 0, nil, dataSize, &tapList)
        
        guard createStatus == noErr else {
            return false
        }
        
        deviceID = aggregateDeviceID
        return true
    }
    
    private func getDeviceUID(device: AudioObjectID) -> CFString? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var uid: CFString?
        var dataSize = UInt32(MemoryLayout<CFString>.size)
        AudioObjectGetPropertyData(device, &propertyAddress, 0, nil, &dataSize, &uid)
        return uid
    }
    
    private func startIO() -> Bool {
        // Create IO proc
        let status = AudioDeviceCreateIOProcID(
            deviceID,
            ioProc,
            Unmanaged.passUnretained(self).toOpaque(),
            &ioProcID
        )
        
        guard status == noErr, let procID = ioProcID else {
            sendError("Failed to create audio IO proc")
            return false
        }
        
        // Start the device
        let startStatus = AudioDeviceStart(deviceID, procID)
        
        guard startStatus == noErr else {
            AudioDeviceDestroyIOProcID(deviceID, procID)
            ioProcID = nil
            sendError("Failed to start audio device")
            return false
        }
        
        isCapturing = true
        return true
    }
    
    private func stopIO() {
        guard let procID = ioProcID else { return }
        AudioDeviceStop(deviceID, procID)
        AudioDeviceDestroyIOProcID(deviceID, procID)
        ioProcID = nil
    }
    
    /// Called from IO proc when audio data is available
    fileprivate func handleAudioData(_ buffer: UnsafeBufferPointer<Float>) {
        // Convert Float32 to Int16 PCM for Deepgram (linear16 encoding)
        let int16Data = buffer.map { sample -> Int16 in
            let clamped = max(-1.0, min(1.0, sample))
            return Int16(clamped * Float(Int16.max))
        }
        
        // Send as base64-encoded data
        let data = int16Data.withUnsafeBufferPointer { ptr in
            Data(buffer: ptr)
        }
        let base64 = data.base64EncodedString()
        
        sendAudioData(base64)
    }
    
    private func sendAudioData(_ base64: String) {
        let message = Message(type: "audio", data: base64, error: nil)
        if let jsonData = try? JSONEncoder().encode(message),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
            fflush(stdout)
        }
    }
    
    private func sendError(_ error: String) {
        let message = Message(type: "error", data: nil, error: error)
        if let jsonData = try? JSONEncoder().encode(message),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
            fflush(stdout)
        }
    }
    
    func sendReady() {
        let message = Message(type: "ready", data: nil, error: nil)
        if let jsonData = try? JSONEncoder().encode(message),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
            fflush(stdout)
        }
    }
    
    func sendStarted() {
        let message = Message(type: "started", data: nil, error: nil)
        if let jsonData = try? JSONEncoder().encode(message),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
            fflush(stdout)
        }
    }
    
    func sendStopped() {
        let message = Message(type: "stopped", data: nil, error: nil)
        if let jsonData = try? JSONEncoder().encode(message),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
            fflush(stdout)
        }
    }
}

// IO Proc callback
private let ioProc: AudioDeviceIOProc = { (
    inDevice: AudioObjectID,
    inNow: UnsafePointer<AudioTimeStamp>,
    inInputData: UnsafePointer<AudioBufferList>,
    inInputTime: UnsafePointer<AudioTimeStamp>,
    outOutputData: UnsafeMutablePointer<AudioBufferList>,
    inOutputTime: UnsafePointer<AudioTimeStamp>,
    inClientData: UnsafeMutableRawPointer?
) -> OSStatus in
    guard let clientData = inClientData else { return noErr }
    
    let manager = Unmanaged<AudioCaptureManager>.fromOpaque(clientData).takeUnretainedValue()
    let bufferList = inInputData.pointee
    
    // Process all input buffers
    for i in 0..<Int(bufferList.mNumberBuffers) {
        let buffer = bufferList.mBuffers
        
        if let data = buffer.mData, buffer.mDataByteSize > 0 {
            let floatCount = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
            let floatPtr = data.assumingMemoryBound(to: Float.self)
            let bufferPointer = UnsafeBufferPointer(start: floatPtr, count: floatCount)
            
            manager.handleAudioData(bufferPointer)
        }
    }
    
    return noErr
}

// MARK: - Main

let manager = AudioCaptureManager()

// Send ready message
manager.sendReady()

// Read commands from stdin
while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let command = try? JSONDecoder().decode([String: String].self, from: data) else {
        continue
    }
    
    switch command["command"] {
    case "start":
        let mode = CaptureMode(rawValue: Int(command["mode"] ?? "1") ?? 1) ?? .systemAudio
        let sampleRate = UInt32(command["sampleRate"] ?? "48000") ?? 48000
        let channels = UInt32(command["channels"] ?? "1") ?? 1
        
        if manager.startCapture(sampleRate: sampleRate, channels: channels, mode: mode) {
            manager.sendStarted()
        }
        
    case "stop":
        manager.stopCapture()
        manager.sendStopped()
        
    case "quit":
        manager.stopCapture()
        exit(0)
        
    default:
        break
    }
}

// Keep running
RunLoop.main.run()
